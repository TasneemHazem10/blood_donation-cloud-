'use strict';

const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestEnv, jsonResponse, cleanupSqlite, daysAgoText, futureDate, INTERNAL_KEY } = require('./helpers/env');
const { check } = require('./helpers/harness');

const settings = setupTestEnv('donor-api');

const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { setServiceFetch } = require('../shared/serviceClient');
const { createApp } = require('../services/donor/app');

const store = setStore(createSqliteStore(settings.sqlitePath));
const app = createApp();
app.set('trust proxy', true); // lets each test use a distinct rate-limit bucket

let activeBookings = { count: 0, bookings: [] };
setServiceFetch(async (url) => {
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith('/active-bookings')) return jsonResponse(200, activeBookings);
  if (parsed.pathname.endsWith('/anonymize')) return jsonResponse(200, { bookings: 0, reminders: 0 });
  return jsonResponse(500, { error: { message: `Unexpected stub call ${parsed.pathname}` } });
});

let ipCounter = 0;
function client() {
  ipCounter += 1;
  return request.agent(app).set('X-Forwarded-For', `10.${ipCounter}.0.1`);
}

const donorBody = {
  name: 'Donor One',
  email: 'donor1@example.org',
  password: 'passport123',
  bloodType: 'O+',
  weightKg: 70,
  birthYear: 1990,
  phone: '55512345'
};

let donorToken;
let organizerToken;

check('DN01', 'donor registration creates account and profile', async () => {
  const res = await client().post('/api/auth/register').send(donorBody);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.role, 'donor');
  assert.equal(res.body.user.email, donorBody.email);
  assert.ok(res.body.token);
  donorToken = res.body.token;

  const profile = await store.get('bdo_donors', donorBody.email);
  assert.equal(profile.bloodType, 'O+');
  assert.equal(profile.weightKg, 70);
  assert.equal(profile.lastDonationDate, null);
});

check('DN02', 'registration rejects duplicates and invalid fields', async () => {
  const duplicate = await client().post('/api/auth/register').send(donorBody);
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error.message, /already exists/);

  const badEmail = await client().post('/api/auth/register').send({ ...donorBody, email: 'not-an-email' });
  assert.equal(badEmail.status, 400);
  assert.match(badEmail.body.error.message, /valid email/);

  const shortPassword = await client().post('/api/auth/register').send({ ...donorBody, email: 'x1@example.org', password: 'short' });
  assert.equal(shortPassword.status, 400);
  assert.match(shortPassword.body.error.message, /password must be 8-128/);

  const badBlood = await client().post('/api/auth/register').send({
    ...donorBody, email: 'x2@example.org', bloodType: 'Z+'
  });
  assert.equal(badBlood.status, 400);
  assert.match(badBlood.body.error.message, /bloodType must be one of/);

  const badYear = await client().post('/api/auth/register').send({
    ...donorBody, email: 'x3@example.org', birthYear: 1800
  });
  assert.equal(badYear.status, 400);
  assert.match(badYear.body.error.message, /birthYear must be a valid year/);
});

check('DN03', 'organizer registration requires the invite code', async () => {
  const wrong = await client().post('/api/auth/register').send({
    name: 'Organizer One', email: 'org1@example.org', password: 'passport123',
    role: 'organizer', inviteCode: 'wrong'
  });
  assert.equal(wrong.status, 409);
  assert.match(wrong.body.error.message, /invite code is not correct/);

  const correct = await client().post('/api/auth/register').send({
    name: 'Organizer One', email: 'org1@example.org', password: 'passport123',
    role: 'organizer', inviteCode: 'blood2026'
  });
  assert.equal(correct.status, 201, JSON.stringify(correct.body));
  assert.equal(correct.body.user.role, 'organizer');
  organizerToken = correct.body.token;
});

check('DN04', 'login and me require valid credentials', async () => {
  const login = await client().post('/api/auth/login').send({ email: donorBody.email, password: donorBody.password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, donorBody.email);

  const wrongPassword = await client().post('/api/auth/login').send({ email: donorBody.email, password: 'wrongpass' });
  assert.equal(wrongPassword.status, 401);

  const unknown = await client().post('/api/auth/login').send({ email: 'nobody@example.org', password: 'passport123' });
  assert.equal(unknown.status, 401);

  const me = await client().get('/api/auth/me').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'donor');

  const noToken = await client().get('/api/auth/me');
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'UNAUTHORIZED');
});

check('DN05', 'profile read and update enforce role, auth and validation', async () => {
  const profile = await client().get('/api/donors/me').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.donor.bloodType, 'O+');
  assert.equal(profile.body.donor.eligibility.eligible, true);

  const updated = await client().put('/api/donors/me').set('Authorization', `Bearer ${donorToken}`)
    .send({ weightKg: 72, phone: '999' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.donor.weightKg, 72);

  const empty = await client().put('/api/donors/me').set('Authorization', `Bearer ${donorToken}`).send({});
  assert.equal(empty.status, 409);

  const invalid = await client().put('/api/donors/me').set('Authorization', `Bearer ${donorToken}`)
    .send({ bloodType: 'AB?' });
  assert.equal(invalid.status, 400);

  const organizer = await client().get('/api/donors/me').set('Authorization', `Bearer ${organizerToken}`);
  assert.equal(organizer.status, 403);

  const noToken = await client().get('/api/donors/me');
  assert.equal(noToken.status, 401);
});

check('DN06', 'eligibility endpoint reports 56-day and deferral rules', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const eligible = await client().get('/api/donors/me/eligibility').query({ date })
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(eligible.status, 200);
  assert.equal(eligible.body.eligible, true);
  assert.equal(eligible.body.evaluatedOn, date);

  await store.update('bdo_donors', donorBody.email, { lastDonationDate: daysAgoText(40) });
  const tooSoon = await client().get('/api/donors/me/eligibility').query({ date })
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(tooSoon.body.eligible, false);
  assert.match(tooSoon.body.reason, /At least 56 days/);

  await store.update('bdo_donors', donorBody.email, { lastDonationDate: null, deferredUntil: futureDate(30) });
  const deferred = await client().get('/api/donors/me/eligibility').query({ date })
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(deferred.body.eligible, false);
  assert.match(deferred.body.reason, /deferred until/);

  const badDate = await client().get('/api/donors/me/eligibility').query({ date: 'bad-date' })
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(badDate.status, 400);

  await store.update('bdo_donors', donorBody.email, { lastDonationDate: null, deferredUntil: null });
});

check('DN07', 'internal donation recording is idempotent and protected', async () => {
  const payload = { donationId: 'don_test_1', donorId: donorBody.email, driveId: 'drv_test_1', date: futureDate(1) };

  const noKey = await client().post('/internal/donations').send(payload);
  assert.equal(noKey.status, 401);

  const created = await client().post('/internal/donations').set('x-internal-key', INTERNAL_KEY).send(payload);
  assert.equal(created.status, 201);
  assert.equal(created.body.duplicate, false);

  const repeated = await client().post('/internal/donations').set('x-internal-key', INTERNAL_KEY).send(payload);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.duplicate, true);

  const unknownDonor = await client().post('/internal/donations').set('x-internal-key', INTERNAL_KEY)
    .send({ ...payload, donationId: 'don_test_2', donorId: 'nobody@example.org' });
  assert.equal(unknownDonor.status, 404);

  const badDate = await client().post('/internal/donations').set('x-internal-key', INTERNAL_KEY)
    .send({ ...payload, donationId: 'don_test_3', date: 'nope' });
  assert.equal(badDate.status, 400);

  const donations = await client().get('/api/donors/me/donations').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donations.status, 200);
  assert.equal(donations.body.count, 1);
  assert.equal(donations.body.donations[0].id, 'don_test_1');
});

check('DN08', 'internal donor lookups protect the internal key', async () => {
  const noKey = await client().get(`/internal/donors/${donorBody.email}`);
  assert.equal(noKey.status, 401);

  const got = await client().get(`/internal/donors/${donorBody.email}`).set('x-internal-key', INTERNAL_KEY);
  assert.equal(got.status, 200);
  assert.equal(got.body.donor.bloodType, 'O+');

  const missing = await client().get('/internal/donors/nobody@example.org').set('x-internal-key', INTERNAL_KEY);
  assert.equal(missing.status, 404);

  const eligibility = await client().get(`/internal/donors/${donorBody.email}/eligibility`)
    .query({ date: futureDate(60) }).set('x-internal-key', INTERNAL_KEY);
  assert.equal(eligibility.status, 200);
  assert.equal(eligibility.body.eligible, true);
  assert.equal(eligibility.body.donor.id, donorBody.email);

  const unknownEligibility = await client().get('/internal/donors/nobody@example.org/eligibility')
    .set('x-internal-key', INTERNAL_KEY);
  assert.equal(unknownEligibility.body.eligible, false);
  assert.equal(unknownEligibility.body.donor, null);
});

check('DN09', 'account deletion is blocked by active bookings and then succeeds', async () => {
  activeBookings = { count: 1, bookings: [{ id: 'b1' }] };
  const blocked = await client().delete('/api/donors/me').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /Cancel your 1 upcoming booking/);

  activeBookings = { count: 0, bookings: [] };
  const deleted = await client().delete('/api/donors/me').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(deleted.status, 204);

  assert.equal(await store.get('bdo_users', donorBody.email), null);
  assert.equal(await store.get('bdo_donors', donorBody.email), null);

  const login = await client().post('/api/auth/login').send({ email: donorBody.email, password: donorBody.password });
  assert.equal(login.status, 401);
});

process.on('beforeExit', () => cleanupSqlite(settings.sqlitePath, store));
