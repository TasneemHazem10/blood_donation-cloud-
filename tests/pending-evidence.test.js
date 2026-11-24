'use strict';

// Regression coverage for two scenarios that previously had no automated
// evidence: the login/register rate limit (DON-14) and the Turnstile "configured
// but token missing" branch (DON-16). Neither test calls an external service.
const assert = require('node:assert/strict');
const request = require('supertest');
const { after } = require('node:test');
const { setupTestEnv, cleanupSqlite } = require('./helpers/env');
const { check } = require('./helpers/harness');

const settings = setupTestEnv('pending-evidence');

const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { createApp } = require('../services/donor/app');

const store = setStore(createSqliteStore(settings.sqlitePath));
const app = createApp();
app.set('trust proxy', true);

const donorBody = {
  name: 'Bot Check Donor',
  email: 'bot-check@example.org',
  password: 'DemoPass123!',
  role: 'donor',
  bloodType: 'O+',
  weightKg: 68,
  birthYear: 1998
};

check('DON-14', 'nine login attempts from one IP trigger 429 RATE_LIMIT', async () => {
  const statuses = [];
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.99.0.1')
      .send({ email: 'rate-limit@example.org', password: 'wrong-password' });
    statuses.push(res.status);
    if (attempt <= 8) assert.equal(res.status, 401, `attempt ${attempt} should be 401`);
  }
  assert.equal(statuses[8], 429);
  const limited = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.99.0.1')
    .send({ email: 'rate-limit@example.org', password: 'wrong-password' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT');
  assert.match(limited.body.error.message, /wait 10 minutes/i);
});

check('DON-16', 'a configured Turnstile secret rejects a missing token with 401', async () => {
  const previousMode = process.env.TEST_MODE;
  const previousSecret = process.env.TURNSTILE_SECRET;
  delete process.env.TEST_MODE;
  // Dummy value: the missing-token branch returns before any network call, so
  // no real Cloudflare credential is needed and nothing is sent upstream.
  process.env.TURNSTILE_SECRET = 'dummy-secret-for-missing-token-branch';
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', '10.99.0.2')
      .send(donorBody);
    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.match(res.body.error.message, /bot check is required/i);
    const user = await store.get('bdo_users', donorBody.email);
    assert.equal(user, null, 'a rejected bot check must not create an account');
  } finally {
    if (previousMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = previousSecret;
  }
});

after(() => cleanupSqlite(settings.sqlitePath, store));
