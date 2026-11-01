<?php
/**
 * Spectrum Credit Limited - PHP API Router & Front Controller
 * Run with: php -S 127.0.0.1:8000 -t php
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit(0);
}

require_once __DIR__ . '/autoload.php';
require_once __DIR__ . '/database/Database.php';
require_once __DIR__ . '/database/Seed.php';
require_once __DIR__ . '/controllers/ApplicationController.php';
require_once __DIR__ . '/controllers/LeaseController.php';
require_once __DIR__ . '/controllers/PaymentController.php';
require_once __DIR__ . '/controllers/WebhookController.php';
require_once __DIR__ . '/models/Product.php';
require_once __DIR__ . '/models/Customer.php';
require_once __DIR__ . '/models/Pricing.php';

use SpectrumCredit\Database\Database;
use SpectrumCredit\Database\Seed;
use SpectrumCredit\Controllers\ApplicationController;
use SpectrumCredit\Controllers\LeaseController;
use SpectrumCredit\Controllers\PaymentController;
use SpectrumCredit\Controllers\WebhookController;
use SpectrumCredit\Models\Product;
use SpectrumCredit\Models\Customer;
use SpectrumCredit\Models\Pricing;


$uri = parse_url($_SERVER['REQUEST_URI'], \PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Parse JSON request body
$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?? [];

function json(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit(0);
}

try {
    // Bootstrap the database inside the request error handler so connection,
    // migration, and seeding failures are returned as JSON like route errors.
    Database::getConnection();
    if (empty(Customer::all())) {
        Seed::run();
    }

    // 1. Health & Root
    if ($uri === '/' || $uri === '/api' || $uri === '/api/health') {
        json([
            'status' => 'ok',
            'service' => 'Spectrum Credit Phone Lease Desk PHP API',
            'version' => '1.0.0',
            'database' => 'SQLite (Active)',
            'time' => date('Y-m-d H:i:s')
        ]);
    }

    // 2. Catalogue
    if ($uri === '/api/catalogue' && $method === 'GET') {
        $products = Product::all();
        foreach ($products as &$p) {
            $p['pricings'] = Pricing::forProduct($p['id']);
        }
        json(['catalogue' => $products]);
    }


    // 3. Customers
    if ($uri === '/api/customers' && $method === 'GET') {
        json(['customers' => Customer::all()]);
    }

    // 4. Applications
    $appCtrl = new ApplicationController();
    if ($uri === '/api/applications' && $method === 'GET') {
        json(['applications' => $appCtrl->index()]);
    }
    if ($uri === '/api/applications' && $method === 'POST') {
        json($appCtrl->create($body), 201);
    }
    if (preg_match('#^/api/applications/(\d+)$#', $uri, $m) && $method === 'GET') {
        $app = $appCtrl->show((int)$m[1]);
        if (!$app) json(['error' => 'Application not found'], 404);
        json($app);
    }
    if (preg_match('#^/api/applications/(\d+)/review$#', $uri, $m) && $method === 'POST') {
        json($appCtrl->review((int)$m[1], $body));
    }

    // 5. Leases
    $leaseCtrl = new LeaseController();
    if ($uri === '/api/leases' && $method === 'GET') {
        json(['leases' => $leaseCtrl->index()]);
    }
    if ($uri === '/api/leases/activate' && $method === 'POST') {
        json($leaseCtrl->activate($body), 201);
    }
    if (preg_match('#^/api/leases/(\d+)$#', $uri, $m) && $method === 'GET') {
        $lease = $leaseCtrl->show((int)$m[1]);
        if (!$lease) json(['error' => 'Lease not found'], 404);
        json($lease);
    }
    if (preg_match('#^/api/leases/(\d+)/transfer$#', $uri, $m) && $method === 'POST') {
        json($leaseCtrl->transferOwnership((int)$m[1], $body));
    }

    // 6. Payments & STK Push
    $payCtrl = new PaymentController();
    if ($uri === '/api/mpesa/stkpush' && $method === 'POST') {
        json($payCtrl->stkPush($body));
    }
    if ($uri === '/api/payments' && $method === 'POST') {
        json($payCtrl->record($body));
    }

    // 7. Webhooks
    $webhookCtrl = new WebhookController();
    if ($uri === '/api/mpesa/callback' && $method === 'POST') {
        json($webhookCtrl->handleStkCallback($body));
    }
    if ($uri === '/api/mpesa/c2b/validation' && $method === 'POST') {
        json($webhookCtrl->handleC2bValidation($body));
    }
    if ($uri === '/api/mpesa/c2b/confirmation' && $method === 'POST') {
        json($webhookCtrl->handleC2bConfirmation($body));
    }

    json(['error' => "Endpoint {$method} {$uri} not found"], 404);
} catch (\Throwable $e) {
    json([
        'error' => $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ], 500);
}
