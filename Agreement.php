<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Agreement extends Model {
    protected static string $table = 'agreements';

    public static function forApplication(int $appId): ?array {
        return self::findBy('application_id', $appId);
    }
}
