'use strict';

// Shared test bootstrap. Every test file gets its own SQLite file and its own
// module cache (node:test runs each file in a separate process), so settings
// must be installed before any application module is required.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const JWT_SECRET = 'bdo-test-jwt-secret';
const INTERNAL_KEY = 'bdo-test-internal-key';
const ORGANIZER_INVITE = 'blood2026';

function setupTestEnv(tag, overrides = {}) {
  const sqlitePath = path.join(os.tmpdir(), `bdo-test-${tag}-${crypto.randomUUID()}.sqlite`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    TEST_MODE: '1',
    EMAIL_MODE: 'log',
    DATA_DRIVER: 'sqlite',
    SQLITE_PATH: sqlitePath,
    JWT_SECRET,
    INTERNAL_KEY,
    ORGANIZER_INVITE,
    CORS_ORIGINS: 'http://localhost:8090',
    DRIVE_SERVICE_URL: 'http://127.0.0.1:4101',
    DONOR_SERVICE_URL: 'http://127.0.0.1:4102',
    BOOKING_SERVICE_URL: 'http://127.0.0.1:4103',
    ...overrides
  });
  return { sqlitePath, jwtSecret: JWT_SECRET, internalKey: INTERNAL_KEY, organizerInvite: ORGANIZER_INVITE };
}

async function token(user, secret = JWT_SECRET) {
  const { createToken } = require('../../shared/crypto');
  return createToken(user, secret);
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cleanupSqlite(sqlitePath, store) {
  if (store) {
    try { store.close(); } catch { /* already closed */ }
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(`${sqlitePath}${suffix}`, { force: true }); } catch { /* best effort */ }
  }
}

function futureDate(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function daysAgoText(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

module.exports = {
  setupTestEnv, token, jsonResponse, cleanupSqlite, futureDate, daysAgoText,
  JWT_SECRET, INTERNAL_KEY, ORGANIZER_INVITE
};
