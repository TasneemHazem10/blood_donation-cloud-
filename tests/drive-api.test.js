'use strict';

const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestEnv, token, jsonResponse, cleanupSqlite, futureDate, INTERNAL_KEY } = require('./helpers/env');
const { check } = require('./helpers/harness');

const settings = setupTestEnv('drive-api');

const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { setServiceFetch } = require('../shared/serviceClient');
const { createApp } = require('../services/drive/app');

const store = setStore(createSqliteStore(settings.sqlitePath));
const app = createApp();

let statsBody = { booked: 0, confirmed: 0, attended: 0, noShow: 0, cancelled: 0, total: 0 };
let cancellationCalls = 0;
const serviceCalls = [];

setServiceFetch(async (url, options) => {
  const parsed = new URL(String(url));
  serviceCalls.push({ url: parsed.toString(), method: options.method, headers: options.headers });
  if (parsed.pathname.endsWith('/stats')) return jsonResponse(200, statsBody);
  if (parsed.pathname.endsWith('/cancellations')) {
    cancellationCalls += 1;
    return jsonResponse(200, { driveId: parsed.pathname.split('/')[3], cancelled: 0, released: 0 });
  }
  return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: `Unexpected stub call ${parsed.pathname}` } });
});

const org = { id: 'org1@example.org', email: 'org1@example.org', name: 'Organizer One', role: 'organizer' };
const otherOrg = { id: 'org2@example.org', email: 'org2@example.org', name: 'Organizer Two', role: 'organizer' };
const donor = { id: 'donor1@example.org', email: 'donor1@example.org', name: 'Donor One', role: 'donor' };

let orgToken;
let otherOrgToken;
let donorToken;
let driveId;
let slotId;

check('DR01', 'health and empty drive list are reachable without auth', async () => {
  const health = await request(app).get('/api/health/drive');
  assert.equal(health.status, 200);
  assert.equal(health.body.service, 'drive');

  const list = await request(app).get('/api/drives');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 0);
  assert.deepEqual(list.body.drives, []);
});

check('DR02', 'organizer creates a drive and retrieves it by id', async () => {
  orgToken = await token(org);
  otherOrgToken = await token(otherOrg);
  donorToken = await token(donor);

  const created = await request(app).post('/api/drives').set('Authorization', `Bearer ${orgToken}`).send({
    title: 'Community Blood Drive',
    venue: 'City Hall',
    city: 'Kuwait City',
    date: futureDate(10),
    description: 'Weekly drive'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.id, /^drv_/);
  assert.equal(created.body.status, 'scheduled');
  assert.equal(created.body.organizerId, org.id);
  driveId = created.body.id;

  const got = await request(app).get(`/api/drives/${driveId}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.title, 'Community Blood Drive');
  assert.deepEqual(got.body.slots, []);

  const list = await request(app).get('/api/drives').query({ city: 'kuwait' });
  assert.equal(list.body.count, 1);
  assert.equal(list.body.drives[0].id, driveId);
});

check('DR03', 'drive creation requires a token and the organizer role', async () => {
  const noToken = await request(app).post('/api/drives').send({ title: 'x' });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'UNAUTHORIZED');

  const badToken = await request(app).post('/api/drives')
    .set('Authorization', `Bearer ${await token(org, 'wrong-secret')}`).send({});
  assert.equal(badToken.status, 401);

  const wrongRole = await request(app).post('/api/drives').set('Authorization', `Bearer ${donorToken}`).send({
    title: 'Donor Drive', venue: 'Hall', city: 'Kuwait', date: futureDate(10)
  });
  assert.equal(wrongRole.status, 403);
  assert.equal(wrongRole.body.error.code, 'FORBIDDEN');
});

check('DR04', 'drive input validation returns 400', async () => {
  const missing = await request(app).post('/api/drives').set('Authorization', `Bearer ${orgToken}`).send({
    venue: 'Hall', city: 'Kuwait', date: futureDate(10)
  });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error.message, /title is required|title must be 3-120/);

  const badDate = await request(app).post('/api/drives').set('Authorization', `Bearer ${orgToken}`).send({
    title: 'Valid Drive', venue: 'Hall', city: 'Kuwait', date: '2026-02-30'
  });
  assert.equal(badDate.status, 400);
  assert.match(badDate.body.error.message, /date must be a valid date/);

  const longDescription = await request(app).post('/api/drives').set('Authorization', `Bearer ${orgToken}`).send({
    title: 'Valid Drive', venue: 'Hall', city: 'Kuwait', date: futureDate(10), description: 'x'.repeat(1001)
  });
  assert.equal(longDescription.status, 400);
});

check('DR05', 'organizer updates a drive; other organizers and unknown ids fail', async () => {
  const updated = await request(app).put(`/api/drives/${driveId}`).set('Authorization', `Bearer ${orgToken}`)
    .send({ title: 'Updated Drive' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.title, 'Updated Drive');

  const other = await request(app).put(`/api/drives/${driveId}`).set('Authorization', `Bearer ${otherOrgToken}`)
    .send({ title: 'Hijacked' });
  assert.equal(other.status, 403);
  assert.match(other.body.error.message, /Only the organizer/);

  const missing = await request(app).put('/api/drives/drv_missing').set('Authorization', `Bearer ${orgToken}`)
    .send({ title: 'Nope' });
  assert.equal(missing.status, 404);

  const badInput = await request(app).put(`/api/drives/${driveId}`).set('Authorization', `Bearer ${orgToken}`)
    .send({ city: 'X' });
  assert.equal(badInput.status, 400);
});

check('DR06', 'slots are created, validated and checked for overlaps', async () => {
  const created = await request(app).post(`/api/drives/${driveId}/slots`).set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '09:00', endTime: '11:00', capacity: 2 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  slotId = created.body.id;
  assert.equal(created.body.booked, 0);

  const overlap = await request(app).post(`/api/drives/${driveId}/slots`).set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '10:30', endTime: '12:00', capacity: 2 });
  assert.equal(overlap.status, 409);
  assert.match(overlap.body.error.message, /Time overlaps/);

  const badTime = await request(app).post(`/api/drives/${driveId}/slots`).set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '23:00', endTime: '09:00', capacity: 2 });
  assert.equal(badTime.status, 400);

  const badCapacity = await request(app).post(`/api/drives/${driveId}/slots`).set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '11:00', endTime: '12:00', capacity: 0 });
  assert.equal(badCapacity.status, 400);

  const got = await request(app).get(`/api/drives/${driveId}`);
  assert.equal(got.body.slots.length, 1);
  assert.equal(got.body.slots[0].available, 2);
});

check('DR07', 'slot update and delete reject overbooking states', async () => {
  await store.put('bdo_slots', { ...(await store.get('bdo_slots', slotId)), booked: 2 });

  const invalidCapacity = await request(app).put(`/api/drives/${driveId}/slots/${slotId}`)
    .set('Authorization', `Bearer ${orgToken}`).send({ capacity: 0 });
  assert.equal(invalidCapacity.status, 400);

  const lowerCapacity = await request(app).put(`/api/drives/${driveId}/slots/${slotId}`)
    .set('Authorization', `Bearer ${orgToken}`).send({ capacity: 1 });
  assert.equal(lowerCapacity.status, 409);
  assert.match(lowerCapacity.body.error.message, /Capacity cannot be lower/);

  const deleteBooked = await request(app).delete(`/api/drives/${driveId}/slots/${slotId}`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(deleteBooked.status, 409);
  assert.match(deleteBooked.body.error.message, /bookings cannot be deleted/);

  const updated = await request(app).put(`/api/drives/${driveId}/slots/${slotId}`)
    .set('Authorization', `Bearer ${orgToken}`).send({ capacity: 3 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.capacity, 3);

  await store.put('bdo_slots', { ...(await store.get('bdo_slots', slotId)), booked: 0 });

  const missingSlot = await request(app).delete(`/api/drives/${driveId}/slots/slt_missing`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(missingSlot.status, 409);
});

check('DR08', 'internal reservation endpoints enforce the internal key and seat limits', async () => {
  const missingKey = await request(app).post(`/internal/drives/${driveId}/slots/${slotId}/reservation`).send({});
  assert.equal(missingKey.status, 401);

  const wrongKey = await request(app).post(`/internal/drives/${driveId}/slots/${slotId}/reservation`)
    .set('x-internal-key', 'wrong').send({});
  assert.equal(wrongKey.status, 401);

  const internalGet = await request(app).get(`/internal/drives/${driveId}`).set('x-internal-key', INTERNAL_KEY);
  assert.equal(internalGet.status, 200);
  assert.equal(internalGet.body.slots[0].capacity, 3);

  const reserve = await request(app).post(`/internal/drives/${driveId}/slots/${slotId}/reservation`)
    .set('x-internal-key', INTERNAL_KEY).send({});
  assert.equal(reserve.status, 200);
  assert.equal(reserve.body.booked, 1);

  await store.put('bdo_slots', { ...(await store.get('bdo_slots', slotId)), capacity: 1 });
  const full = await request(app).post(`/internal/drives/${driveId}/slots/${slotId}/reservation`)
    .set('x-internal-key', INTERNAL_KEY).send({});
  assert.equal(full.status, 409);
  assert.match(full.body.error.message, /slot is full/);

  const release = await request(app).delete(`/internal/drives/${driveId}/slots/${slotId}/reservation`)
    .set('x-internal-key', INTERNAL_KEY);
  assert.equal(release.status, 200);
  assert.equal(release.body.booked, 0);

  const wrongSlot = await request(app).post(`/internal/drives/${driveId}/slots/slt_missing/reservation`)
    .set('x-internal-key', INTERNAL_KEY).send({});
  assert.equal(wrongSlot.status, 409);
  await store.put('bdo_slots', { ...(await store.get('bdo_slots', slotId)), capacity: 3 });
});

check('DR09', 'report and report list are organizer-only and use booking stats', async () => {
  statsBody = { booked: 3, confirmed: 3, attended: 1, noShow: 1, cancelled: 1, total: 5 };
  const report = await request(app).get(`/api/drives/${driveId}/report`).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.booked, 3);
  assert.equal(report.body.capacity, 3);
  assert.equal(report.body.fillRate, 100);
  assert.equal(report.body.turnoutRate, 33.3);
  assert.equal(report.body.storage, 'database');
  assert.match(report.body.location, /^report:/);

  const reports = await request(app).get(`/api/drives/${driveId}/reports`).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(reports.status, 200);
  assert.equal(reports.body.count, 1);

  const donorReport = await request(app).get(`/api/drives/${driveId}/report`).set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorReport.status, 403);

  const unknown = await request(app).get('/api/drives/drv_missing/report').set('Authorization', `Bearer ${orgToken}`);
  assert.equal(unknown.status, 404);
});

check('DR10', 'status changes validate input and cancel through booking service', async () => {
  const bad = await request(app).patch(`/api/drives/${driveId}/status`).set('Authorization', `Bearer ${orgToken}`)
    .send({ status: 'paused' });
  assert.equal(bad.status, 400);

  const futureComplete = await request(app).patch(`/api/drives/${driveId}/status`)
    .set('Authorization', `Bearer ${orgToken}`).send({ status: 'completed' });
  assert.equal(futureComplete.status, 409);
  assert.match(futureComplete.body.error.message, /future drive cannot be completed/);

  const cancelled = await request(app).patch(`/api/drives/${driveId}/status`)
    .set('Authorization', `Bearer ${orgToken}`).send({ status: 'cancelled' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(cancellationCalls, 1);

  const again = await request(app).patch(`/api/drives/${driveId}/status`)
    .set('Authorization', `Bearer ${orgToken}`).send({ status: 'cancelled' });
  assert.equal(again.status, 409);

  const missing = await request(app).patch('/api/drives/drv_missing/status')
    .set('Authorization', `Bearer ${orgToken}`).send({ status: 'cancelled' });
  assert.equal(missing.status, 404);
});

check('DR11', 'editing a cancelled drive is rejected and unknown ids return 404', async () => {
  const slotCreate = await request(app).post(`/api/drives/${driveId}/slots`).set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '12:00', endTime: '13:00', capacity: 2 });
  assert.equal(slotCreate.status, 409);
  assert.match(slotCreate.body.error.message, /cancelled drive cannot be edited/);

  const missing = await request(app).get('/api/drives/drv_does_not_exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const deleteUnknown = await request(app).delete('/api/drives/drv_does_not_exist')
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(deleteUnknown.status, 404);
});

check('DR12', 'deleting a drive is blocked by active bookings then succeeds', async () => {
  statsBody = { booked: 1, confirmed: 1, attended: 0, noShow: 0, cancelled: 0, total: 1 };
  const blocked = await request(app).delete(`/api/drives/${driveId}`).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /bookings before deleting/);

  // Attendance history is also a booking; deleting it would orphan donations.
  statsBody = { booked: 1, confirmed: 0, attended: 1, noShow: 0, cancelled: 0, total: 1 };
  const blockedHistory = await request(app).delete(`/api/drives/${driveId}`).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(blockedHistory.status, 409);

  statsBody = { booked: 0, confirmed: 0, attended: 0, noShow: 0, cancelled: 1, total: 1 };
  const deleted = await request(app).delete(`/api/drives/${driveId}`).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(deleted.status, 204);

  const gone = await request(app).get(`/api/drives/${driveId}`);
  assert.equal(gone.status, 404);
  assert.equal(await store.get('bdo_slots', slotId), null);
});

check('DR13', 'cross-service calls include the internal key', () => {
  assert.ok(serviceCalls.length >= 4);
  for (const call of serviceCalls) {
    assert.equal(call.headers['x-internal-key'], INTERNAL_KEY);
  }
});

process.on('beforeExit', () => cleanupSqlite(settings.sqlitePath, store));
