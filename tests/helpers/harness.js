'use strict';

// Tiny wrapper around node:test that records stable test IDs and prints a
// compact PASS/FAIL summary after all tests in the current test file finish.
const { test, after } = require('node:test');
const path = require('node:path');

const results = [];
let summaryRegistered = false;

function registerSummary() {
  if (summaryRegistered) return;
  summaryRegistered = true;
  after(() => {
    const file = path.basename(process.argv[1] || 'test', '.js');
    process.stdout.write(`\n[SUMMARY ${file}] ${results.length} tests\n`);
    for (const result of results) {
      process.stdout.write(`  ${result.id} ${String(result.status).padEnd(4)} ${result.name}\n`);
    }
  });
}

function check(id, name, fn, options) {
  registerSummary();
  test(`${id} ${name}`, async (t) => {
    try {
      await fn(t);
      results.push({ id, name, status: 'PASS' });
    } catch (error) {
      results.push({ id, name, status: 'FAIL' });
      throw error;
    }
  }, options);
}

module.exports = { check };
