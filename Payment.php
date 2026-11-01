<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Payment extends Model {
    protected static string $table = 'payments';

    public static function findByReceipt(string $ref): ?array {
        return self::findBy('payment_reference', $ref);
    }

    public static function forLease(int $leaseId): array {
        return self::where('lease_id', $leaseId);
    }
}
