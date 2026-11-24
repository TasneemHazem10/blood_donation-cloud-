'use strict';

/*
 * Captures reproducible request/response evidence for three cases that need
 * more than the ordinary test suite:
 *   DON-14 - nine logins from one IP produce the ninth 429
 *   DON-16 - Turnstile configured (dummy secret) but no token produces 401
 *   DRV-05 - a live OpenStreetMap Nominatim geocode feeds ?near= search
 *
 * No real credential is written to disk. The Turnstile secret used here is a
 * dummy value: the missing-token branch returns before calling Cloudflare.
 * Output files go to evidence/ and can be attached to the report.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const root = path.resolve(__dirname, '../..');
const evidenceDir = path.join(root, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const { setupTestEnv, token } = require(path.join(root, 'tests/helpers/env'));

function write(name, lines) {
  const header = [
    `Captured: ${new Date().toISOString()}`,
    'Secrets/tokens are redacted. Dummy values are labelled.',
    ''
  ];
  const file = path.join(evidenceDir, name);
  fs.writeFileSync(file, `${header.concat(lines).join('\n')}\n`);
  console.log(`WROTE evidence/${name}`);
}

async function captureRateLimit() {
  const settings = setupTestEnv('evidence-rate-limit');
  const { createSqliteStore } = require(path.join(root, 'shared/store/sqlite'));
  const { setStore } = require(path.join(root, 'shared/context'));
  const { createApp } = require(path.join(root, 'services/donor/app'));

  const store = setStore(createSqliteStore(settings.sqlitePath));
  const app = createApp();
  app.set('trust proxy', true);

  const lines = [
    'DON-14 - login rate limit (8 attempts allowed, 9th blocked)',
    'POST /api/auth/login  X-Forwarded-For: 10.99.0.1  body: {"email":"rate-limit@example.org","password":"<wrong>"}',
    ''
  ];
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.99.0.1')
      .send({ email: 'rate-limit@example.org', password: 'wrong-password' });
    lines.push(`attempt ${attempt}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  write('DON-14-rate-limit.txt', lines);
  store.close();
}

async function captureTurnstileMissingToken() {
  const settings = setupTestEnv('evidence-turnstile');
  const { createSqliteStore } = require(path.join(root, 'shared/store/sqlite'));
  const { setStore } = require(path.join(root, 'shared/context'));
  const { createApp } = require(path.join(root, 'services/donor/app'));

  const store = setStore(createSqliteStore(settings.sqlitePath));
  const app = createApp();
  app.set('trust proxy', true);

  delete process.env.TEST_MODE;
  process.env.TURNSTILE_SECRET = 'dummy-secret-for-missing-token-branch';

  const body = {
    name: 'Bot Check Donor',
    email: 'bot-check@example.org',
    password: 'DemoPass123!',
    role: 'donor',
    bloodType: 'O+',
    weightKg: 68,
    birthYear: 1998
  };
  const actual = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', '10.99.0.2')
    .send(body);
  const user = await store.get('bdo_users', body.email);

  write('DON-16-turnstile-missing-token.txt', [
    'DON-16 - Turnstile configured but no token supplied',
    `Config: TEST_MODE unset, TURNSTILE_SECRET=${process.env.TURNSTILE_SECRET} (dummy, never sent upstream)`,
    'POST /api/auth/register without turnstileToken (password redacted from this log)',
    `HTTP ${actual.status} ${JSON.stringify(actual.body)}`,
    `bdo_users row created: ${user ? 'YES (unexpected)' : 'NO (expected)'}`
  ]);
  store.close();
}

async function captureLiveGeocode() {
  // Empty TEST_MODE switches config().testMode off but keeps deterministic,
  // isolated SQLite storage and fixed JWT secrets for the evidence run.
  const settings = setupTestEnv('evidence-geocode', { TEST_MODE: '' });
  const { createSqliteStore } = require(path.join(root, 'shared/store/sqlite'));
  const { setStore } = require(path.join(root, 'shared/context'));
  const { setServiceFetch } = require(path.join(root, 'shared/serviceClient'));
  const { createApp } = require(path.join(root, 'services/drive/app'));

  const store = setStore(createSqliteStore(settings.sqlitePath));
  setServiceFetch(async () => new Response(JSON.stringify({
    booked: 0, confirmed: 0, attended: 0, noShow: 0, cancelled: 0, total: 0
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const app = createApp();
  const org = { id: 'org@example.org', email: 'org@example.org', name: 'Evidence Organizer', role: 'organizer' };
  const orgToken = await token(org, settings.jwtSecret);

  const lines = [
    'DRV-05 - live Nominatim geocode and ?near= radius search',
    `External service: https://nominatim.openstreetmap.org/search (User-Agent: BDO-Cloud-Project/1.0)`,
    ''
  ];

  const created = await request(app)
    .post('/api/drives')
    .set('Authorization', `Bearer ${orgToken}`)
    .send({
      title: 'Live Geocode Drive',
      venue: 'Kuwait City',
      city: 'Kuwait',
      date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      description: 'Evidence run with real geocoding'
    });
  lines.push(`POST /api/drives -> HTTP ${created.status}`);
  lines.push(`created drive: ${JSON.stringify({
    id: created.body.id,
    lat: created.body.lat,
    lon: created.body.lon,
    locationLabel: created.body.locationLabel
  })}`);

  // Respect the Nominatim usage policy (no more than one request per second).
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const near = await request(app).get('/api/drives?near=Kuwait%20City&radius=25');
  lines.push('');
  lines.push(`GET /api/drives?near=Kuwait%20City&radius=25 -> HTTP ${near.status}`);
  lines.push(JSON.stringify(near.body, null, 2));
  lines.push('');
  lines.push('Cached geocode rows in SQLite bdo_geocodes:');
  lines.push(JSON.stringify(await store.all('bdo_geocodes'), null, 2));

  write('DRV-05-live-geocode.txt', lines);
  store.close();
}

(async () => {
  await captureRateLimit();
  await captureTurnstileMissingToken();
  await captureLiveGeocode();
  console.log('Evidence capture complete.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
