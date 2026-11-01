/**
 * Spectrum Credit Phone Lease Desk - Node.js Server
 * Providing static file hosting, REST endpoints, and M-PESA webhook simulation.
 * Compatible with Node.js v18+ with zero external npm dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Load Spectrum Credit Core Modules
const { ROLES, DEFAULT_PERMS } = require('./js/data');

const { KES, money, D, normPhone, luhnOk, makeImei, buildSchedule } = require('./js/ledger');
const { Engine } = require('./js/engine');
const { runAllTests, runTest, TESTS } = require('./js/uat');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// In-memory audit log for server-side events
const serverAuditLogs = [];

function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({ raw: body });
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end();
    return;
  }

  // --- API Routes ---
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Health check
      if (pathname === '/api/health' && method === 'GET') {
        return jsonResponse(res, 200, {
          status: 'ok',
          service: 'Spectrum Credit Phone Lease Desk API',
          version: '1.0.0',
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        });
      }

      // 2. Roles & Permissions
      if (pathname === '/api/roles' && method === 'GET') {
        return jsonResponse(res, 200, {
          roles: ROLES,
          permissions: DEFAULT_PERMS
        });
      }

      // 3. Catalogue
      if (pathname === '/api/catalogue' && method === 'GET') {
        return jsonResponse(res, 200, {
          catalogue: []
        });
      }

      // 4. Run Automated UAT Tests
      if (pathname === '/api/test/run' && method === 'POST') {
        const body = await parseBody(req);
        if (body.testId) {
          const t = TESTS.find(x => x.id === body.testId);
          if (!t) return jsonResponse(res, 404, { error: `Test ${body.testId} not found` });
          const result = runTest(t);
          return jsonResponse(res, 200, result);
        }
        const report = runAllTests();
        return jsonResponse(res, 200, report);
      }

      // 5. M-PESA Daraja STK Push Initiation
      if (pathname === '/api/mpesa/stkpush' && method === 'POST') {
        const body = await parseBody(req);
        const phone = normPhone(body.phone || '');
        const amount = Number(body.amount) || 0;
        const ref = body.accountReference || 'SPECTRUM-REF';

        if (!phone || phone.length !== 12 || !phone.startsWith('2547') && !phone.startsWith('2541')) {
          return jsonResponse(res, 400, {
            ResponseCode: '1',
            ResponseDescription: 'Invalid Safaricom phone number format'
          });
        }

        if (amount <= 0) {
          return jsonResponse(res, 400, {
            ResponseCode: '1',
            ResponseDescription: 'Amount must be greater than zero'
          });
        }

        const merchantRequestId = 'MR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const checkoutRequestId = 'ws_CO_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

        serverAuditLogs.push({
          time: new Date().toISOString(),
          type: 'STK_PUSH_INITIATED',
          phone,
          amount,
          ref,
          checkoutRequestId
        });

        return jsonResponse(res, 200, {
          MerchantRequestID: merchantRequestId,
          CheckoutRequestID: checkoutRequestId,
          ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing',
          CustomerMessage: 'Success. Request accepted for processing'
        });
      }

      // 6. M-PESA STK Push Callback (Result Receiver)
      if (pathname === '/api/mpesa/callback' && method === 'POST') {
        const body = await parseBody(req);
        const callbackData = body.Body && body.Body.stkCallback ? body.Body.stkCallback : body;

        serverAuditLogs.push({
          time: new Date().toISOString(),
          type: 'STK_PUSH_CALLBACK',
          payload: callbackData
        });

        return jsonResponse(res, 200, {
          ResultCode: 0,
          ResultDesc: 'Callback accepted and queued for processing'
        });
      }

      // 7. M-PESA C2B Paybill Validation
      if (pathname === '/api/mpesa/c2b/validation' && method === 'POST') {
        const body = await parseBody(req);
        // Safaricom validation hook requires ResultCode 0 for accept, 1 for reject
        const billRef = (body.BillRefNumber || '').trim();
        return jsonResponse(res, 200, {
          ResultCode: 0,
          ResultDesc: 'Accepted'
        });
      }

      // 8. M-PESA C2B Paybill Confirmation
      if (pathname === '/api/mpesa/c2b/confirmation' && method === 'POST') {
        const body = await parseBody(req);
        serverAuditLogs.push({
          time: new Date().toISOString(),
          type: 'C2B_CONFIRMATION',
          payload: body
        });
        return jsonResponse(res, 200, {
          ResultCode: 0,
          ResultDesc: 'Payment confirmation received'
        });
      }

      // 9. Credit Assessment & Policy Engine Check
      if (pathname === '/api/engine/evaluate' && method === 'POST') {
        const body = await parseBody(req);
        const engine = new Engine();
        const appId = engine.createApp(body.customer || {}, body.termMonths || 6, body.pricingIndex || 0);
        const app = engine.s.apps[appId];
        return jsonResponse(res, 200, {
          appId,
          score: app.score,
          hardStops: app.hardStops,
          status: app.status
        });
      }

      // 10. Audit Logs
      if (pathname === '/api/audit' && method === 'GET') {
        return jsonResponse(res, 200, {
          count: serverAuditLogs.length,
          logs: serverAuditLogs
        });
      }

      // Route not found
      return jsonResponse(res, 404, { error: `Endpoint ${method} ${pathname} not found` });
    } catch (err) {
      console.error('API Error:', err);
      return jsonResponse(res, 500, { error: err.message || 'Internal Server Error' });
    }
  }

  // --- Static File Serving ---
  let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const filePath = path.join(__dirname, safePath);

  // Guard against directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404 Not Found</h1><p>The file <code>${safePath}</code> was not found on this server.</p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  Spectrum Credit Phone Lease Desk Server`);
  console.log(`  Running at: http://${HOST}:${PORT}`);
  console.log(`  Health API: http://${HOST}:${PORT}/api/health`);
  console.log(`  Test API:   http://${HOST}:${PORT}/api/test/run`);
  console.log(`====================================================`);
});


// Graceful termination handling
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
