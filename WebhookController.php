<?php
namespace SpectrumCredit\Controllers;

require_once __DIR__ . '/../services/MpesaService.php';
require_once __DIR__ . '/../models/AuditLog.php';

use SpectrumCredit\Services\MpesaService;
use SpectrumCredit\Models\AuditLog;


class WebhookController {
    /**
     * Safaricom STK Callback
     */
    public function handleStkCallback(array $payload): array {
        AuditLog::log('Webhook', 'DARAJA_STK', 'RECEIVE_CALLBACK', 'System', 'Safaricom Gateway', $payload);

        $stk = $payload['Body']['stkCallback'] ?? $payload;
        $resultCode = $stk['ResultCode'] ?? -1;

        if ($resultCode === 0) {
            // Payment succeeded
            $meta = $stk['CallbackMetadata']['Item'] ?? [];
            $amount = 0;
            $receipt = '';
            $phone = '';

            foreach ($meta as $item) {
                if ($item['Name'] === 'Amount') $amount = (int)($item['Value'] * 100);
                if ($item['Name'] === 'MpesaReceiptNumber') $receipt = (string)$item['Value'];
                if ($item['Name'] === 'PhoneNumber') $phone = (string)$item['Value'];
            }

            if ($receipt && $amount > 0) {
                MpesaService::processPayment($receipt, $phone, $amount, 'ONLINE_STK', 'INSTALLMENT');
            }
        }

        return ['ResultCode' => 0, 'ResultDesc' => 'Accepted'];
    }

    /**
     * Safaricom C2B Validation Hook
     */
    public function handleC2bValidation(array $payload): array {
        return ['ResultCode' => 0, 'ResultDesc' => 'Accepted'];
    }

    /**
     * Safaricom C2B Confirmation Hook
     */
    public function handleC2bConfirmation(array $payload): array {
        AuditLog::log('Webhook', 'DARAJA_C2B', 'RECEIVE_CONFIRMATION', 'System', 'Safaricom Gateway', $payload);

        $receipt = $payload['TransID'] ?? '';
        $amount = (int)(($payload['TransAmount'] ?? 0) * 100);
        $phone = $payload['MSISDN'] ?? '';
        $billRef = $payload['BillRefNumber'] ?? '';

        if ($receipt && $amount > 0) {
            MpesaService::processPayment($receipt, $phone, $amount, $billRef, 'INSTALLMENT');
        }

        return ['ResultCode' => 0, 'ResultDesc' => 'Confirmation received'];
    }
}
