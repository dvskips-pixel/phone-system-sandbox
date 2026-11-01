<?php
namespace SpectrumCredit\Controllers;

require_once __DIR__ . '/../models/Lease.php';
require_once __DIR__ . '/../models/Installment.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/LedgerEntry.php';
require_once __DIR__ . '/../services/LeaseEngine.php';

use SpectrumCredit\Models\Lease;
use SpectrumCredit\Models\Installment;
use SpectrumCredit\Models\Payment;
use SpectrumCredit\Models\LedgerEntry;
use SpectrumCredit\Services\LeaseEngine;


class LeaseController {
    public function index(): array {
        return Lease::all();
    }

    public function show(int $id): ?array {
        $lease = Lease::find($id);
        if (!$lease) return null;
        $lease['installments'] = Installment::forLease($id);
        $lease['payments'] = Payment::forLease($id);
        $lease['ledger'] = LedgerEntry::forReference('LEASE', $lease['lease_no']);
        return $lease;
    }

    public function activate(array $data): array {
        $appId = (int)($data['application_id'] ?? 0);
        $deviceId = (int)($data['device_id'] ?? 0);
        $user = $data['user'] ?? 'Technician Peter';

        return LeaseEngine::activateLease($appId, $deviceId, $user);
    }

    public function transferOwnership(int $id, array $data): array {
        $imei = $data['imei'] ?? '';
        $role = $data['role'] ?? 'Ops Lead';
        $user = $data['user'] ?? 'Lead Mercy';

        return LeaseEngine::transferOwnership($id, $imei, $role, $user);
    }
}
