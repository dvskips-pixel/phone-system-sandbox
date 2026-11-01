<?php
namespace SpectrumCredit\Database;

require_once __DIR__ . '/Database.php';

class Seed {

    private static function luhnCalculate(string $prefix14): string {
        $sum = 0;
        for ($i = 0; $i < 14; $i++) {
            $d = (int)$prefix14[$i];
            if ($i % 2 === 0) {
                $d *= 2;
                if ($d > 9) $d -= 9;
            }
            $sum += $d;
        }
        $check = (10 - ($sum % 10)) % 10;
        return $prefix14 . $check;
    }

    public static function run(): void {
        $db = Database::getConnection();

        // 1. Seed Products and Pricings
        $products = [
            [
                'code' => 'GAL-A15-128', 'brand' => 'Samsung', 'model' => 'Galaxy A15', 'storage' => '128GB', 'cash' => 2050000,
                'prices' => [
                    ['term' => 6, 'total' => 3600000, 'type' => 'fixed', 'val' => 600000, 'status' => 'Active'],
                    ['term' => 12, 'total' => 4680000, 'type' => 'fixed', 'val' => 600000, 'status' => 'Active']
                ]
            ],
            [
                'code' => 'TEC-SP20-256', 'brand' => 'Tecno', 'model' => 'Spark 20 Pro', 'storage' => '256GB', 'cash' => 1850000,
                'prices' => [
                    ['term' => 6, 'total' => 3000000, 'type' => 'fixed', 'val' => 600000, 'status' => 'Active'],
                    ['term' => 9, 'total' => 3300000, 'type' => 'fixed', 'val' => 600000, 'status' => 'Active']
                ]
            ],
            [
                'code' => 'INF-H40I-128', 'brand' => 'Infinix', 'model' => 'Hot 40i', 'storage' => '128GB', 'cash' => 1350000,
                'prices' => [
                    ['term' => 3, 'total' => 1950000, 'type' => 'fixed', 'val' => 450000, 'status' => 'Active'],
                    ['term' => 6, 'total' => 2200000, 'type' => 'fixed', 'val' => 400000, 'status' => 'Active']
                ]
            ],
            [
                'code' => 'RDM-13C-128', 'brand' => 'Redmi', 'model' => '13C', 'storage' => '128GB', 'cash' => 1450000,
                'prices' => [
                    ['term' => 6, 'total' => 2400000, 'type' => 'percent', 'val' => 20, 'status' => 'Active'],
                    ['term' => 12, 'total' => 3120000, 'type' => 'percent', 'val' => 20, 'status' => 'Draft']
                ]
            ]
        ];

        foreach ($products as $p) {
            $stmt = $db->prepare("INSERT OR IGNORE INTO products (code, brand, model, storage, cash_price) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$p['code'], $p['brand'], $p['model'], $p['storage'], $p['cash']]);
            
            $pIdStmt = $db->prepare("SELECT id FROM products WHERE code = ?");
            $pIdStmt->execute([$p['code']]);
            $productId = $pIdStmt->fetchColumn();

            foreach ($p['prices'] as $pr) {
                $chk = $db->prepare("SELECT id FROM pricings WHERE product_id = ? AND term_months = ?");
                $chk->execute([$productId, $pr['term']]);
                if (!$chk->fetch()) {
                    $pStmt = $db->prepare("INSERT INTO pricings (product_id, term_months, total_lease_price, deposit_type, deposit_value, status) VALUES (?, ?, ?, ?, ?, ?)");
                    $pStmt->execute([$productId, $pr['term'], $pr['total'], $pr['type'], $pr['val'], $pr['status']]);
                }
            }

            // Seed inventory devices
            for ($k = 1; $k <= 3; $k++) {
                $p14 = '358' . str_pad((string)($productId * 1000 + $k), 11, '0', STR_PAD_LEFT);
                $imei = self::luhnCalculate($p14);
                $dStmt = $db->prepare("INSERT OR IGNORE INTO devices (product_id, imei, serial_no, condition, status) VALUES (?, ?, ?, 'New', 'In Stock')");
                $dStmt->execute([$productId, $imei, 'SN-' . $p['code'] . '-' . $k]);
            }
        }

        // Customer records are created through the application, not seeded.
    }
}
