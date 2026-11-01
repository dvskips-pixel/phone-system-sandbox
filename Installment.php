<?php
namespace SpectrumCredit\Models;

require_once __DIR__ . '/Model.php';

class Installment extends Model {
    protected static string $table = 'installments';

    public static function forLease(int $leaseId): array {
        return \SpectrumCredit\Database\Database::query(
            "SELECT * FROM installments WHERE lease_id = ? ORDER BY installment_no ASC",
            [$leaseId]
        );
    }
}

