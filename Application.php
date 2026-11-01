<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Application extends Model {
    protected static string $table = 'applications';

    public static function findByAppNo(string $appNo): ?array {
        return self::findBy('app_no', $appNo);
    }

    public static function forCustomer(int $customerId): array {
        return self::where('customer_id', $customerId);
    }
}
