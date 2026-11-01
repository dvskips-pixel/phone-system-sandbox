<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Pricing extends Model {
    protected static string $table = 'pricings';

    public static function forProduct(int $productId): array {
        return self::where('product_id', $productId);
    }
}
