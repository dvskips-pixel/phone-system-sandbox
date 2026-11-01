<?php
namespace SpectrumCredit\Services;

require_once __DIR__ . '/../models/LedgerEntry.php';

use SpectrumCredit\Models\LedgerEntry;


class LedgerService {
    /**
     * Record deposit payment receipt
     */
    public static function postDeposit(string $leaseNo, int $cents, string $receiptNo): void {
        $txId = 'TX-DEP-' . uniqid();
        LedgerEntry::create([
            'transaction_id' => $txId,
            'entry_date' => date('Y-m-d'),
            'debit_account' => '1010-Cash-Mpesa',
            'credit_account' => '2010-Customer-Deposits',
            'amount' => $cents,
            'currency' => 'KES',
            'reference_type' => 'LEASE_DEPOSIT',
            'reference_id' => $leaseNo,
            'description' => "Deposit received via M-PESA receipt {$receiptNo} for lease {$leaseNo}"
        ]);
    }

    /**
     * Record lease activation and device dispatch
     */
    public static function postLeaseActivation(string $leaseNo, int $inventoryCostCents, int $receivableCents): void {
        $txId = 'TX-ACT-' . uniqid();
        // 1. Recognize lease receivable and clear inventory
        LedgerEntry::create([
            'transaction_id' => $txId,
            'entry_date' => date('Y-m-d'),
            'debit_account' => '1200-Lease-Receivable',
            'credit_account' => '1300-Inventory-Phones',
            'amount' => $inventoryCostCents,
            'currency' => 'KES',
            'reference_type' => 'LEASE_ACTIVATION',
            'reference_id' => $leaseNo,
            'description' => "Inventory released for lease {$leaseNo} at cost"
        ]);

        $unearnedIncome = $receivableCents - $inventoryCostCents;
        if ($unearnedIncome > 0) {
            LedgerEntry::create([
                'transaction_id' => $txId,
                'entry_date' => date('Y-m-d'),
                'debit_account' => '1200-Lease-Receivable',
                'credit_account' => '2200-Unearned-Finance-Income',
                'amount' => $unearnedIncome,
                'currency' => 'KES',
                'reference_type' => 'LEASE_ACTIVATION',
                'reference_id' => $leaseNo,
                'description' => "Unearned finance charge recognized on lease {$leaseNo}"
            ]);
        }
    }

    /**
     * Record installment payment
     */
    public static function postInstallment(string $leaseNo, int $cents, string $receiptNo, int $installmentNo): void {
        $txId = 'TX-INST-' . uniqid();
        LedgerEntry::create([
            'transaction_id' => $txId,
            'entry_date' => date('Y-m-d'),
            'debit_account' => '1010-Cash-Mpesa',
            'credit_account' => '1200-Lease-Receivable',
            'amount' => $cents,
            'currency' => 'KES',
            'reference_type' => 'INSTALLMENT_PAYMENT',
            'reference_id' => $leaseNo,
            'description' => "Installment #{$installmentNo} received via M-PESA receipt {$receiptNo} for lease {$leaseNo}"
        ]);
    }

    /**
     * Record fee or interest waiver
     */
    public static function postWaiver(string $leaseNo, int $cents, string $reason): void {
        $txId = 'TX-WAIVE-' . uniqid();
        LedgerEntry::create([
            'transaction_id' => $txId,
            'entry_date' => date('Y-m-d'),
            'debit_account' => '5010-Bad-Debt-Waivers',
            'credit_account' => '1200-Lease-Receivable',
            'amount' => $cents,
            'currency' => 'KES',
            'reference_type' => 'ADJUSTMENT_WAIVER',
            'reference_id' => $leaseNo,
            'description' => "Waiver approved on lease {$leaseNo}: {$reason}"
        ]);
    }
}
