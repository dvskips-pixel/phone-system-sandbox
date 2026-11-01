<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class Lease extends Model {
    protected static string $table = 'leases';

    public static function findByLeaseNo(string $leaseNo): ?array {
        return self::findBy('lease_no', $leaseNo);
    }

    public static function activeLeases(): array {
        return self::where('status', 'Active');
    }
}
