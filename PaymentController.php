<?php
namespace SpectrumCredit\Controllers;

require_once __DIR__ . '/../services/MpesaService.php';

use SpectrumCredit\Services\MpesaService;

class PaymentController {
    public function stkPush(array $data): array {
        $phone = $data['phone'] ?? '';
        $amountCents = (int)($data['amount_cents'] ?? 0);
        $accountRef = $data['account_reference'] ?? 'SPECTRUM-REF';


        return MpesaService::initiateStkPush($phone, $amountCents, $accountRef);
    }

    public function record(array $data): array {
        $receipt = $data['receipt'] ?? ('QHX' . rand(100000, 999999));
        $phone = $data['phone'] ?? '';
        $amountCents = (int)($data['amount_cents'] ?? 0);
        $accountRef = $data['account_reference'] ?? '';
        $purpose = $data['purpose'] ?? 'INSTALLMENT';

        return MpesaService::processPayment($receipt, $phone, $amountCents, $accountRef, $purpose);
    }
}
