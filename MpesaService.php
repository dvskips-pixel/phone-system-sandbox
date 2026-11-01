<?php
namespace SpectrumCredit\Services;

require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Lease.php';
require_once __DIR__ . '/../models/Installment.php';
require_once __DIR__ . '/LedgerService.php';

use SpectrumCredit\Models\Payment;
use SpectrumCredit\Models\Lease;
use SpectrumCredit\Models\Installment;
use SpectrumCredit\Database\Database;


class MpesaService {
    /**
     * Standardize Kenyan phone numbers to 254XXXXXXXXX
     */
    public static function normalizePhone(string $raw): string {
        $p = preg_replace('/\D/', '', $raw);
        if (str_starts_with($p, '0')) {
            $p = '254' . substr($p, 1);
        } else if (str_starts_with($p, '7') || str_starts_with($p, '1')) {
            $p = '254' . $p;
        } else if (str_starts_with($p, '+254')) {
            $p = substr($p, 1);
        }
        return $p;
    }

    /**
     * Generate simulated Daraja STK Push request response
     */
    public static function initiateStkPush(string $phone, int $amountCents, string $accountRef): array {
        $cleanPhone = self::normalizePhone($phone);
        if (strlen($cleanPhone) !== 12 || (!str_starts_with($cleanPhone, '2547') && !str_starts_with($cleanPhone, '2541'))) {
            throw new \InvalidArgumentException("Invalid Kenyan mobile number: {$phone}");
        }
        if ($amountCents <= 0) {
            throw new \InvalidArgumentException("Payment amount must be greater than zero");
        }

        $merchantId = 'MR-' . strtoupper(bin2hex(random_bytes(4)));
        $checkoutId = 'ws_CO_' . time() . '_' . bin2hex(random_bytes(4));

        return [
            'MerchantRequestID' => $merchantId,
            'CheckoutRequestID' => $checkoutId,
            'ResponseCode' => '0',
            'ResponseDescription' => 'Success. Request accepted for processing',
            'CustomerMessage' => 'Success. Request accepted for processing',
            'Phone' => $cleanPhone,
            'Amount' => $amountCents / 100,
            'AccountReference' => $accountRef
        ];
    }

    /**
     * Process incoming M-PESA payment (C2B or STK Callback)
     */
    public static function processPayment(string $receiptNo, string $phone, int $amountCents, string $accountRef, string $purpose = 'INSTALLMENT'): array {
        // 1. Idempotency check: receipt must be unique
        $existing = Payment::findByReceipt($receiptNo);
        if ($existing) {
            return [
                'success' => false,
                'message' => "Duplicate payment: Receipt {$receiptNo} already processed",
                'payment_id' => $existing['id']
            ];
        }

        return Database::transaction(function() use ($receiptNo, $phone, $amountCents, $accountRef, $purpose) {
            // Find target lease by lease_no or account reference
            $lease = Lease::findByLeaseNo($accountRef);
            $leaseId = $lease ? $lease['id'] : null;

            // Record payment
            $paymentId = Payment::create([
                'lease_id' => $leaseId,
                'payment_reference' => $receiptNo,
                'provider' => 'MPESA',
                'phone' => self::normalizePhone($phone),
                'amount' => $amountCents,
                'purpose' => $purpose,
                'account_reference' => $accountRef,
                'status' => 'Confirmed'
            ]);

            if ($lease) {
                // If this is an installment payment, apply to the oldest pending installment
                if ($purpose === 'INSTALLMENT') {
                    $installments = Installment::forLease($lease['id']);
                    $remaining = $amountCents;

                    foreach ($installments as $inst) {
                        if ($remaining <= 0) break;
                        if ($inst['status'] === 'Paid' || $inst['status'] === 'Waived') continue;

                        $due = $inst['expected_amount'] - $inst['paid_amount'];
                        $alloc = min($remaining, $due);

                        $newPaid = $inst['paid_amount'] + $alloc;
                        $newStatus = ($newPaid >= $inst['expected_amount']) ? 'Paid' : 'Partial';

                        Installment::update($inst['id'], [
                            'paid_amount' => $newPaid,
                            'status' => $newStatus,
                            'paid_at' => ($newStatus === 'Paid') ? date('Y-m-d H:i:s') : null
                        ]);

                        $remaining -= $alloc;
                        LedgerService::postInstallment($lease['lease_no'], $alloc, $receiptNo, $inst['installment_no']);
                    }

                    // Update lease principal balance
                    $newBalance = max(0, $lease['principal_balance'] - $amountCents);
                    Lease::update($lease['id'], ['principal_balance' => $newBalance]);
                } else if ($purpose === 'DEPOSIT') {
                    Lease::update($lease['id'], ['deposit_paid' => 1]);
                    LedgerService::postDeposit($lease['lease_no'], $amountCents, $receiptNo);
                }
            }

            return [
                'success' => true,
                'payment_id' => $paymentId,
                'receipt' => $receiptNo,
                'amount_cents' => $amountCents
            ];
        });
    }
}
