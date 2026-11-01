<?php
namespace SpectrumCredit\Controllers;

require_once __DIR__ . '/../models/Application.php';
require_once __DIR__ . '/../models/Customer.php';
require_once __DIR__ . '/../models/Pricing.php';
require_once __DIR__ . '/../services/LeaseEngine.php';

use SpectrumCredit\Models\Application;
use SpectrumCredit\Models\Customer;
use SpectrumCredit\Models\Pricing;
use SpectrumCredit\Services\LeaseEngine;


class ApplicationController {
    public function index(): array {
        return Application::all();
    }

    public function show(int $id): ?array {
        $app = Application::find($id);
        if (!$app) return null;
        $app['customer'] = Customer::find($app['customer_id']);
        $app['pricing'] = Pricing::find($app['pricing_id']);
        return $app;
    }

    public function create(array $data): array {
        $customerId = (int)($data['customer_id'] ?? 0);
        $pricingId = (int)($data['pricing_id'] ?? 0);
        $role = $data['role'] ?? 'Agent';
        $user = $data['user'] ?? 'Agent Kibet';

        return LeaseEngine::createApplication($customerId, $pricingId, $role, $user);
    }

    public function review(int $id, array $data): array {
        $decision = $data['decision'] ?? 'Approved';
        $role = $data['role'] ?? 'Credit Analyst';
        $user = $data['user'] ?? 'Analyst John';
        $reason = $data['reason'] ?? null;

        return LeaseEngine::reviewApplication($id, $decision, $role, $user, $reason);
    }
}