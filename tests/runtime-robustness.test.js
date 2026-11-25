'use strict';

const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestEnv, cleanupSqlite, JWT_SECRET } = require('./helpers/env');
const { check } = require('./helpers/harness');

const settings = setupTestEnv('runtime-robustness');
const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { createApp } = require('../services/donor/app');
const routes = require('../services/donor/routes');
const { workerFetch } = require('../shared/router');
const { jsonResponse } = require('../shared/http');
const { verifyToken, createToken } = require('../shared/crypto');
const { callService, setServiceBindings } = require('../shared/serviceClient');

const store = setStore(createSqliteStore(settings.sqlitePath));
const app = createApp();
app.set('trust proxy', true);

function encodePart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

check('RT01', 'malformed and unsupported JWTs produce 401, never 500', async () => {
  const malformed = await request(app).get('/api/auth/me')
    .set('Authorization', 'Bearer a.b.!');
  assert.equal(malformed.status, 401);
  assert.equal(malformed.body.error.code, 'UNAUTHORIZED');

  await assert.rejects(
    () => verifyToken('%%%.payload.signature', JWT_SECRET),
    (error) => error.status === 401
  );

  const payload = { id: 'donor@example.org', role: 'donor', exp: Math.floor(Date.now() / 1000) + 600 };
  const algNone = `${encodePart({ alg: 'none', typ: 'JWT' })}.${encodePart(payload)}.AA`;
  const rejected = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${algNone}`);
  assert.equal(rejected.status, 401);

  const valid = await createToken(payload, JWT_SECRET);
  assert.equal((await verifyToken(valid, JWT_SECRET)).id, payload.id);
});

check('RT02', 'malformed and oversized JSON bodies use the shared error envelope', async () => {
  const malformed = await request(app).post('/api/auth/register')
    .set('content-type', 'application/json').send('{"email":');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');

  const oversized = await request(app).post('/api/auth/register')
    .set('content-type', 'application/json')
    .send(JSON.stringify({ blob: 'x'.repeat(30000) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'PAYLOAD_TOO_LARGE');
});

check('RT03', 'malformed Worker URL parameters produce 400', async () => {
  const response = await workerFetch(routes, new Request('http://localhost/internal/donors/%E0%A4%A'));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /Malformed URL path/);
});

check('RT04', 'jsonResponse keeps a non-204 status when the body is null', () => {
  const response = jsonResponse(200, null);
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(jsonResponse(204, null).status, 204);
});

check('RT05', 'SQLite CAS is conditional and preserves JSON value types', async () => {
  await store.put('bdo_reminders', { id: 'rt_reminder', status: 'failed', attempts: 1 });
  const first = await store.cas('bdo_reminders', 'rt_reminder',
    { status: 'pending', attempts: 2 }, { status: 'failed', attempts: 1 });
  const second = await store.cas('bdo_reminders', 'rt_reminder',
    { status: 'pending', attempts: 2 }, { status: 'failed', attempts: 1 });
  assert.ok(first);
  assert.equal(first.attempts, 2);
  assert.equal(second, null);
});

check('RT06', 'service bindings resolve before public service URLs', async () => {
  const previous = process.env.DRIVE_SERVICE_URL;
  process.env.DRIVE_SERVICE_URL = '';
  setServiceBindings({
    drive: {
      async fetch() {
        return jsonResponse(200, { ok: true, via: 'binding' });
      }
    }
  });
  try {
    const result = await callService('drive', 'GET', '/api/health/drive');
    assert.deepEqual(result, { ok: true, via: 'binding' });
  } finally {
    setServiceBindings(null);
    process.env.DRIVE_SERVICE_URL = previous;
  }
});

process.on('beforeExit', () => cleanupSqlite(settings.sqlitePath, store));
