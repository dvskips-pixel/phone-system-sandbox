<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Product extends Model {
    protected static string $table = 'products';

    public static function findByCode(string $code): ?array {
        return self::findBy('code', $code);
    }
}
