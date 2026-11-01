#!/usr/bin/env node
/**
 * Spectrum Credit Limited - Build & Verification Script
 * Validates syntax, asset integrity, branding, and executes full UAT test suite.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('======================================================');
console.log('  Spectrum Credit Limited - Build & Verification');
console.log('======================================================');

let errors = 0;

// 1. Validate JS syntax
const jsFiles = [
  'js/data.js',
  'js/ledger.js',
  'js/engine.js',
  'js/uat.js',
  'js/app.js',
  'server.js'
];

jsFiles.forEach(relPath => {
  const fullPath = path.join(__dirname, '..', relPath);
  try {
    const code = fs.readFileSync(fullPath, 'utf8');
    new vm.Script(code, { filename: relPath });
    console.log(`[PASS] Syntax check: ${relPath}`);
  } catch (err) {
    console.error(`[FAIL] Syntax check: ${relPath} - ${err.message}`);
    errors++;
  }
});

// 2. Validate UAT test suite
try {
  const { runAllTests } = require('../js/uat');
  const r = runAllTests();
  if (r.failed > 0) {
    console.error(`[FAIL] UAT Tests: ${r.failed} failed out of ${r.total}`);
    errors++;
  } else {
    console.log(`[PASS] UAT Test Suite: ${r.passed} / ${r.total} passing`);
  }
} catch (err) {
  console.error(`[FAIL] UAT Test Suite execution failed: ${err.message}`);
  errors++;
}

// 3. Validate HTML Entry Point
try {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('Spectrum Credit')) {
    console.error('[FAIL] index.html does not include Spectrum Credit branding');
    errors++;
  } else {
    console.log('[PASS] Static Entry Point: index.html verified');
  }
} catch (err) {
  console.error(`[FAIL] HTML check failed: ${err.message}`);
  errors++;
}

console.log('======================================================');
if (errors > 0) {
  console.error(`Build failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('Build Successful! Desk is ready for deployment/runtime.');
  console.log("Run 'npm start' to start the Node server.");
  console.log('======================================================');
  process.exit(0);
}
