<?php
namespace SpectrumCredit\Models;

require_once __DIR__ . '/Model.php';

class Device extends Model {
    protected static string $table = 'devices';

    public static function findByImei(string $imei): ?array {
        return self::findBy('imei', $imei);
    }

    public static function findAvailable(int $productId): ?array {
        $rows = \SpectrumCredit\Database\Database::query(
            "SELECT * FROM devices WHERE product_id = ? AND status = 'In Stock' LIMIT 1",
            [$productId]
        );
        return $rows[0] ?? null;
    }
}

