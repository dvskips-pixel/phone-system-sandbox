<?php
namespace SpectrumCredit\Services;

require_once __DIR__ . '/../database/Database.php';
require_once __DIR__ . '/../models/Customer.php';
require_once __DIR__ . '/../models/Product.php';
require_once __DIR__ . '/../models/Pricing.php';
require_once __DIR__ . '/../models/Device.php';
require_once __DIR__ . '/../models/Application.php';
require_once __DIR__ . '/../models/Agreement.php';
require_once __DIR__ . '/../models/Lease.php';
require_once __DIR__ . '/../models/Installment.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/AssessmentService.php';
require_once __DIR__ . '/LedgerService.php';

use SpectrumCredit\Models\Customer;
use SpectrumCredit\Models\Product;
use SpectrumCredit\Models\Pricing;
use SpectrumCredit\Models\Device;
use SpectrumCredit\Models\Application;
use SpectrumCredit\Models\Agreement;
use SpectrumCredit\Models\Lease;
use SpectrumCredit\Models\Installment;
use SpectrumCredit\Models\AuditLog;
use SpectrumCredit\Database\Database;


class LeaseEngine {
    /**
     * Luhn Check Digit Verification for 15-digit IMEI
     */
    public static function luhnVerify(string $imei): bool {
        if (!preg_match('/^\d{15}$/', $imei)) return false;
        $sum = 0;
        for ($i = 0; $i < 14; $i++) {
            $d = (int)$imei[$i];
            if ($i % 2 === 0) {
                $d *= 2;
                if ($d > 9) $d -= 9;
            }
            $sum += $d;
        }
        $check = (10 - ($sum % 10)) % 10;
        return $check === (int)$imei[14];
    }

    /**
     * Installment Schedule Builder (Integer Cents, residual cent on final installment)
     */
    public static function buildSchedule(int $totalCents, int $depositCents, int $n): array {
        $bal = $totalCents - $depositCents;
        if ($n <= 0 || $bal <= 0) return [];
        $base = intdiv($bal, $n);
        $schedule = array_fill(0, $n, $base);
        $schedule[$n - 1] = $bal - ($base * ($n - 1));
        return $schedule;
    }

    /**
     * Create New Application
     */
    public static function createApplication(int $customerId, int $pricingId, string $role = 'Agent', string $user = 'Agent Kibet'): array {
        $customer = Customer::find($customerId);
        if (!$customer) throw new \InvalidArgumentException("Customer {$customerId} not found");

        $pricing = Pricing::find($pricingId);
        if (!$pricing) throw new \InvalidArgumentException("Pricing plan {$pricingId} not found");

        $depositCents = ($pricing['deposit_type'] === 'fixed')
            ? $pricing['deposit_value']
            : intdiv($pricing['total_lease_price'] * $pricing['deposit_value'], 100);

        $schedule = self::buildSchedule($pricing['total_lease_price'], $depositCents, $pricing['term_months']);
        $monthlyCents = $schedule[0] ?? 0;

        $assessment = AssessmentService::evaluate($customer, $pricing['term_months'], $monthlyCents);

        $appNo = 'APP-' . strtoupper(bin2hex(random_bytes(3)));
        $status = !empty($assessment['hardStops']) ? 'Rejected' : 'Submitted';

        $appId = Application::create([
            'app_no' => $appNo,
            'customer_id' => $customerId,
            'pricing_id' => $pricingId,
            'created_by_role' => $role,
            'creator_name' => $user,
            'status' => $status,
            'score' => $assessment['score'],
            'rejection_code' => !empty($assessment['hardStops']) ? 'POLICY_HARD_STOP' : null,
            'rejection_reason' => !empty($assessment['hardStops']) ? implode('; ', $assessment['hardStops']) : null
        ]);

        AuditLog::log('Application', (string)$appId, 'CREATE_APPLICATION', $role, $user, [
            'app_no' => $appNo,
            'score' => $assessment['score'],
            'status' => $status
        ]);

        return [
            'app_id' => $appId,
            'app_no' => $appNo,
            'status' => $status,
            'assessment' => $assessment
        ];
    }

    /**
     * Review Application (Segregation of Duties Enforced)
     */
    public static function reviewApplication(int $appId, string $decision, string $reviewerRole, string $reviewerUser, ?string $reason = null): array {
        $app = Application::find($appId);
        if (!$app) throw new \InvalidArgumentException("Application not found");

        if ($app['status'] !== 'Submitted' && $app['status'] !== 'Under Review') {
            throw new \LogicException("Application is already {$app['status']}");
        }

        // Segregation of duties: Creator cannot approve their own application
        if ($app['creator_name'] === $reviewerUser && $decision === 'Approved') {
            throw new \LogicException("Segregation of duties violation: Creator {$reviewerUser} cannot approve their own application");
        }

        $newStatus = ($decision === 'Approved') ? 'Approved' : 'Rejected';
        Application::update($appId, [
            'status' => $newStatus,
            'approved_by_role' => ($decision === 'Approved') ? $reviewerRole : null,
            'approved_by_user' => ($decision === 'Approved') ? $reviewerUser : null,
            'approved_at' => ($decision === 'Approved') ? date('Y-m-d H:i:s') : null,
            'rejection_reason' => ($decision === 'Rejected') ? $reason : null
        ]);

        AuditLog::log('Application', (string)$appId, 'REVIEW_' . strtoupper($decision), $reviewerRole, $reviewerUser, [
            'decision' => $decision,
            'reason' => $reason
        ]);

        return ['success' => true, 'status' => $newStatus];
    }

    /**
     * Generate Digital Agreement
     */
    public static function generateAgreement(int $appId): array {
        $app = Application::find($appId);
        if (!$app || $app['status'] !== 'Approved') {
            throw new \LogicException("Application must be in Approved state to generate agreement");
        }

        $existing = Agreement::forApplication($appId);
        if ($existing) return $existing;

        $clauses = [
            'ownership' => 'Device remains the legal property of Spectrum Credit Limited until all installments are paid in full.',
            'default' => 'Failure to pay installment within 3 days of due date leads to automated device locking.',
            'repossession' => 'Spectrum Credit Limited reserves the right to repossess device after 14 days of delinquency.',
            'jurisdiction' => 'Governed under the laws of the Republic of Kenya and CBK digital credit directives.'
        ];


        $agrNo = 'AGR-' . strtoupper(bin2hex(random_bytes(3)));
        $agrId = Agreement::create([
            'agreement_no' => $agrNo,
            'application_id' => $appId,
            'clauses_json' => json_encode($clauses),
            'status' => 'Draft'
        ]);

        return Agreement::find($agrId);
    }

    /**
     * Sign Agreement by Customer
     */
    public static function signAgreement(int $agrId, string $signatureData): array {
        $agr = Agreement::find($agrId);
        if (!$agr) throw new \InvalidArgumentException("Agreement not found");

        Agreement::update($agrId, [
            'customer_signature' => $signatureData,
            'customer_signed_at' => date('Y-m-d H:i:s'),
            'status' => 'Customer Signed'
        ]);

        return ['success' => true, 'status' => 'Customer Signed'];
    }

    /**
     * Authorize Agreement by Credit/Legal Officer
     */
    public static function authorizeAgreement(int $agrId, string $role, string $user): array {
        $agr = Agreement::find($agrId);
        if (!$agr || $agr['status'] !== 'Customer Signed') {
            throw new \LogicException("Agreement must be Customer Signed prior to officer authorization");
        }

        Agreement::update($agrId, [
            'authorized_by_role' => $role,
            'authorized_by_user' => $user,
            'authorized_at' => date('Y-m-d H:i:s'),
            'status' => 'Authorized'
        ]);

        return ['success' => true, 'status' => 'Authorized'];
    }

    /**
     * Activate Lease & Handover Device
     */
    public static function activateLease(int $appId, int $deviceId, string $handoverUser): array {
        $app = Application::find($appId);
        $agr = Agreement::forApplication($appId);
        $device = Device::find($deviceId);
        $pricing = Pricing::find($app['pricing_id']);
        $product = Product::find($pricing['product_id']);

        if (!$agr || $agr['status'] !== 'Authorized') {
            throw new \LogicException("Agreement must be Authorized before device handover");
        }
        if (!$device || $device['status'] !== 'In Stock') {
            throw new \LogicException("Device must be in stock");
        }
        if (!self::luhnVerify($device['imei'])) {
            throw new \LogicException("Device IMEI {$device['imei']} failed Luhn verification");
        }

        return Database::transaction(function() use ($app, $agr, $device, $pricing, $product, $handoverUser) {
            $depositCents = ($pricing['deposit_type'] === 'fixed')
                ? $pricing['deposit_value']
                : intdiv($pricing['total_lease_price'] * $pricing['deposit_value'], 100);

            $leaseNo = 'LSE-' . strtoupper(bin2hex(random_bytes(3)));
            $schedule = self::buildSchedule($pricing['total_lease_price'], $depositCents, $pricing['term_months']);

            $startDate = date('Y-m-d');
            $endDate = date('Y-m-d', strtotime("+{$pricing['term_months']} months"));

            $leaseId = Lease::create([
                'lease_no' => $leaseNo,
                'application_id' => $app['id'],
                'agreement_id' => $agr['id'],
                'customer_id' => $app['customer_id'],
                'device_id' => $device['id'],
                'pricing_id' => $pricing['id'],
                'term_months' => $pricing['term_months'],
                'total_amount' => $pricing['total_lease_price'],
                'deposit_amount' => $depositCents,
                'deposit_paid' => 1,
                'principal_balance' => $pricing['total_lease_price'] - $depositCents,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'status' => 'Active',
                'handover_by' => $handoverUser,
                'handover_at' => date('Y-m-d H:i:s')
            ]);

            // Create installments
            for ($i = 0; $i < count($schedule); $i++) {
                $monthNum = $i + 1;
                $dueDate = date('Y-m-d', strtotime("+{$monthNum} months"));
                Installment::create([
                    'lease_id' => $leaseId,
                    'installment_no' => $monthNum,
                    'due_date' => $dueDate,
                    'expected_amount' => $schedule[$i],
                    'paid_amount' => 0,
                    'status' => 'Pending'
                ]);
            }

            // Update device status
            Device::update($device['id'], ['status' => 'In Lease']);

            // Post initial ledger activation entries
            LedgerService::postLeaseActivation($leaseNo, $product['cash_price'], $pricing['total_lease_price']);

            return [
                'lease_id' => $leaseId,
                'lease_no' => $leaseNo,
                'status' => 'Active'
            ];
        });
    }

    /**
     * Transfer Ownership (Strict 5-Gate Verification)
     */
    public static function transferOwnership(int $leaseId, string $confirmedImei, string $role, string $user): array {
        $lease = Lease::find($leaseId);
        if (!$lease) throw new \InvalidArgumentException("Lease not found");

        $device = Device::find($lease['device_id']);
        $agr = Agreement::find($lease['agreement_id']);
        $installments = Installment::forLease($leaseId);

        // Gate 1: Zero Outstanding Balance
        if ($lease['principal_balance'] > 0) {
            throw new \LogicException("Gate 1 Failed: Lease has outstanding balance of KES " . ($lease['principal_balance'] / 100));
        }

        // Gate 2: All Installments Settled or Waived
        foreach ($installments as $inst) {
            if ($inst['status'] !== 'Paid' && $inst['status'] !== 'Waived') {
                throw new \LogicException("Gate 2 Failed: Installment #{$inst['installment_no']} is {$inst['status']}");
            }
        }

        // Gate 3: Physical Device IMEI Matches Records
        if ($device['imei'] !== $confirmedImei) {
            throw new \LogicException("Gate 3 Failed: Provided IMEI {$confirmedImei} does not match assigned IMEI {$device['imei']}");
        }

        // Gate 4: No Open Disputes
        $disputes = Database::query("SELECT COUNT(*) as cnt FROM disputes WHERE lease_id = ? AND status = 'Open'", [$leaseId]);
        if (($disputes[0]['cnt'] ?? 0) > 0) {
            throw new \LogicException("Gate 4 Failed: Lease has unresolved open disputes");
        }

        // Gate 5: Executed Digital Agreement
        if (!$agr || ($agr['status'] !== 'Authorized' && $agr['status'] !== 'Executed')) {
            throw new \LogicException("Gate 5 Failed: Digital agreement was never authorized or executed");
        }

        // All 5 checks passed! Execute ownership transfer
        Lease::update($leaseId, [
            'status' => 'Settled',
            'ownership_transferred' => 1,
            'ownership_transferred_at' => date('Y-m-d H:i:s')
        ]);

        Device::update($device['id'], [
            'status' => 'Ownership Transferred'
        ]);

        AuditLog::log('Lease', (string)$leaseId, 'TRANSFER_OWNERSHIP', $role, $user, [
            'imei' => $confirmedImei,
            'lease_no' => $lease['lease_no']
        ]);

        return [
            'success' => true,
            'message' => 'Ownership successfully transferred to customer. Device locking profile released.',
            'lease_no' => $lease['lease_no'],
            'imei' => $confirmedImei
        ];
    }
}
