<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Customer extends Model {
    protected static string $table = 'customers';

    public static function findByNationalId(string $id): ?array {
        return self::findBy('national_id', $id);
    }

    public static function findByPhone(string $phone): ?array {
        return self::findBy('phone', $phone);
    }
}
