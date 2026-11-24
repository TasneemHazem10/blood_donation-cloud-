'use strict';

const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestEnv, token, jsonResponse, cleanupSqlite, futureDate, INTERNAL_KEY } = require('./helpers/env');
const { check } = require('./helpers/harness');

const settings = setupTestEnv('booking-api');

const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { setServiceFetch } = require('../shared/serviceClient');
const { createApp } = require('../services/booking/app');

const store = setStore(createSqliteStore(settings.sqlitePath));
const app = createApp();

const org = { id: 'org1@example.org', email: 'org1@example.org', name: 'Organizer One', role: 'organizer' };
const otherOrg = { id: 'org2@example.org', email: 'org2@example.org', name: 'Organizer Two', role: 'organizer' };
const donor = { id: 'donor1@example.org', email: 'donor1@example.org', name: 'Donor One', role: 'donor' };
const otherDonor = { id: 'donor2@example.org', email: 'donor2@example.org', name: 'Donor Two', role: 'donor' };

const driveId = 'drv_api_test';
const slotId = 'slt_api_test';
const driveDate = futureDate(7);

let eligibilityResponse = {
  eligible: true,
  reason: 'OK',
  donor: { id: donor.id, name: donor.name, email: donor.email, bloodType: 'O+' }
};
let reservationError = false;
const calls = [];

setServiceFetch(async (url, options) => {
  const parsed = new URL(String(url));
  calls.push({ url: parsed.toString(), method: options.method });
  if (parsed.pathname === `/internal/drives/${driveId}` && options.method === 'GET') {
    return jsonResponse(200, {
      id: driveId, title: 'API Drive', date: driveDate, status: 'scheduled',
      organizerId: org.id, venue: 'City Hall', city: 'Kuwait',
      slots: [{ id: slotId, startTime: '09:00', endTime: '11:00', capacity: 5, booked: 0, available: 5 }]
    });
  }
  if (parsed.pathname.includes('/eligibility')) return jsonResponse(200, eligibilityResponse);
  if (parsed.pathname.includes('/reservation')) {
    if (reservationError) return jsonResponse(409, { error: { code: 'CONFLICT', message: 'This slot is full' } });
    return jsonResponse(200, { id: slotId, booked: 1, capacity: 5 });
  }
  if (parsed.pathname === '/internal/donations') {
    return jsonResponse(201, { donation: { id: 'don_api_1' }, duplicate: false });
  }
  return jsonResponse(500, { error: { message: `Unexpected stub call ${parsed.pathname}` } });
});

let orgToken;
let otherOrgToken;
let donorToken;
let otherDonorToken;
const originalKey = `${driveId}__${donor.id}`;

function bookingTemplate(id) {
  return {
    id, driveId, slotId, donorId: donor.id, organizerId: org.id,
    driveTitle: 'API Drive', driveDate, startTime: '09:00', endTime: '11:00',
    venue: 'City Hall', donorName: donor.name, donorEmail: donor.email,
    bloodType: 'O+', status: 'confirmed', createdAt: new Date().toISOString()
  };
}

check('BK01', 'donor creates a booking and duplicate booking is rejected', async () => {
  orgToken = await token(org);
  otherOrgToken = await token(otherOrg);
  donorToken = await token(donor);
  otherDonorToken = await token(otherDonor);

  const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${donorToken}`)
    .send({ driveId, slotId });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.booking.id, originalKey);
  assert.equal(created.body.booking.status, 'confirmed');
  assert.equal(created.body.booking.donorId, donor.id);

  const duplicate = await request(app).post('/api/bookings').set('Authorization', `Bearer ${donorToken}`)
    .send({ driveId, slotId });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error.message, /already have a booking/);

  const reminders = await store.all('bdo_reminders');
  assert.ok(reminders.some((row) => row.type === 'confirmation' && row.bookingId === originalKey));
});

check('BK02', 'booking creation requires donor role, token and valid ids', async () => {
  const noToken = await request(app).post('/api/bookings').send({ driveId, slotId });
  assert.equal(noToken.status, 401);

  const wrongRole = await request(app).post('/api/bookings').set('Authorization', `Bearer ${orgToken}`)
    .send({ driveId, slotId });
  assert.equal(wrongRole.status, 403);

  const badDrive = await request(app).post('/api/bookings').set('Authorization', `Bearer ${donorToken}`)
    .send({ driveId: 'bad id!', slotId });
  assert.equal(badDrive.status, 400);

  const badSlot = await request(app).post('/api/bookings').set('Authorization', `Bearer ${donorToken}`)
    .send({ driveId, slotId: 'bad slot!' });
  assert.equal(badSlot.status, 400);
});

check('BK03', 'ineligible donors and full slots produce 409 conflicts', async () => {
  eligibilityResponse = { eligible: false, reason: 'You must wait 56 days', donor: eligibilityResponse.donor };
  const ineligible = await request(app).post('/api/bookings').set('Authorization', `Bearer ${otherDonorToken}`)
    .send({ driveId, slotId });
  assert.equal(ineligible.status, 409);
  assert.match(ineligible.body.error.message, /wait 56 days/);
  eligibilityResponse = { eligible: true, reason: 'OK', donor: eligibilityResponse.donor };

  reservationError = true;
  const full = await request(app).post('/api/bookings').set('Authorization', `Bearer ${otherDonorToken}`)
    .send({ driveId, slotId });
  assert.equal(full.status, 409);
  assert.match(full.body.error.message, /slot is full/);
  reservationError = false;

  const noSlot = await request(app).post('/api/bookings').set('Authorization', `Bearer ${otherDonorToken}`)
    .send({ driveId, slotId: 'slt_unknown' });
  assert.equal(noSlot.status, 409);
  assert.match(noSlot.body.error.message, /Slot not found/);
});

check('BK04', 'my bookings are scoped to the token owner', async () => {
  const mine = await request(app).get('/api/bookings/mine').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.count, 1);
  assert.equal(mine.body.bookings[0].id, originalKey);

  const otherMine = await request(app).get('/api/bookings/mine').set('Authorization', `Bearer ${otherDonorToken}`);
  assert.equal(otherMine.body.count, 0);

  const noToken = await request(app).get('/api/bookings/mine');
  assert.equal(noToken.status, 401);
});

check('BK05', 'drive booking list is organizer-only and scoped to the owner', async () => {
  const ok = await request(app).get('/api/bookings').query({ driveId }).set('Authorization', `Bearer ${orgToken}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.count, 1);

  const donorList = await request(app).get('/api/bookings').query({ driveId }).set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorList.status, 403);

  const otherOrgList = await request(app).get('/api/bookings').query({ driveId }).set('Authorization', `Bearer ${otherOrgToken}`);
  assert.equal(otherOrgList.status, 403);
  assert.match(otherOrgList.body.error.message, /belongs to another organizer/);

  const missingId = await request(app).get('/api/bookings').set('Authorization', `Bearer ${orgToken}`);
  assert.equal(missingId.status, 400);
});

check('BK06', 'cancel checks ownership and status before releasing a seat', async () => {
  const wrongOwner = await request(app).post(`/api/bookings/${encodeURIComponent(originalKey)}/cancel`)
    .set('Authorization', `Bearer ${otherDonorToken}`);
  assert.equal(wrongOwner.status, 403);
  assert.match(wrongOwner.body.error.message, /belongs to another account/);

  const releasesBefore = calls.filter((call) => call.method === 'DELETE' && call.url.includes('/reservation')).length;
  const cancelled = await request(app).post(`/api/bookings/${encodeURIComponent(originalKey)}/cancel`)
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.booking.status, 'cancelled');

  const releasesAfter = calls.filter((call) => call.method === 'DELETE' && call.url.includes('/reservation')).length;
  assert.equal(releasesAfter, releasesBefore + 1);

  const again = await request(app).post(`/api/bookings/${encodeURIComponent(originalKey)}/cancel`)
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(again.status, 409);
  assert.match(again.body.error.message, /already cancelled/);

  const missing = await request(app).post('/api/bookings/bkg_missing/cancel')
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(missing.status, 409);
});

check('BK07', 'check-in validates outcome, ownership and records donations', async () => {
  await store.put('bdo_bookings', bookingTemplate('bkg_api_attended'));
  await store.put('bdo_bookings', bookingTemplate('bkg_api_noshow'));

  const badOutcome = await request(app).patch('/api/bookings/bkg_api_attended/check-in')
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'late' });
  assert.equal(badOutcome.status, 400);

  const donorCheckIn = await request(app).patch('/api/bookings/bkg_api_attended/check-in')
    .set('Authorization', `Bearer ${donorToken}`).send({ outcome: 'attended' });
  assert.equal(donorCheckIn.status, 403);

  const wrongOrg = await request(app).patch('/api/bookings/bkg_api_attended/check-in')
    .set('Authorization', `Bearer ${otherOrgToken}`).send({ outcome: 'attended' });
  assert.equal(wrongOrg.status, 403);

  const attended = await request(app).patch('/api/bookings/bkg_api_attended/check-in')
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'attended' });
  assert.equal(attended.status, 200, JSON.stringify(attended.body));
  assert.equal(attended.body.booking.status, 'attended');
  assert.ok(calls.some((call) => call.url.endsWith('/internal/donations')));

  const repeated = await request(app).patch('/api/bookings/bkg_api_attended/check-in')
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'attended' });
  assert.equal(repeated.body.message, 'Check-in was already recorded.');

  const noShow = await request(app).patch('/api/bookings/bkg_api_noshow/check-in')
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'no_show' });
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.booking.status, 'no_show');

  const cancelledCheckIn = await request(app).patch(`/api/bookings/${encodeURIComponent(originalKey)}/check-in`)
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'attended' });
  assert.equal(cancelledCheckIn.status, 409);
});

check('BK08', 'reminders send once per booking/date and are organizer-only', async () => {
  await store.put('bdo_bookings', bookingTemplate('bkg_api_reminder'));

  const first = await request(app).post('/api/reminders/send').set('Authorization', `Bearer ${orgToken}`)
    .send({ date: driveDate });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.date, driveDate);
  assert.equal(first.body.eligible, 1);
  assert.equal(first.body.sent, 1);
  assert.equal(first.body.skipped, 0);
  assert.equal(first.body.emailMode, 'log');

  const second = await request(app).post('/api/reminders/send').set('Authorization', `Bearer ${orgToken}`)
    .send({ date: driveDate });
  assert.equal(second.body.sent, 0);
  assert.equal(second.body.skipped, 1);

  const badDate = await request(app).post('/api/reminders/send').set('Authorization', `Bearer ${orgToken}`)
    .send({ date: 'tomorrow' });
  assert.equal(badDate.status, 400);

  const donorSend = await request(app).post('/api/reminders/send').set('Authorization', `Bearer ${donorToken}`)
    .send({ date: driveDate });
  assert.equal(donorSend.status, 403);

  const list = await request(app).get('/api/reminders').set('Authorization', `Bearer ${orgToken}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.count >= 2);
  assert.ok(list.body.reminders.some((row) => row.type === 'reminder'));

  const donorList = await request(app).get('/api/reminders').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorList.status, 403);
});

check('BK09', 'internal stats, cancellations and daily reminders require the key', async () => {
  const noKey = await request(app).get(`/internal/drives/${driveId}/stats`);
  assert.equal(noKey.status, 401);

  const stats = await request(app).get(`/internal/drives/${driveId}/stats`).set('x-internal-key', INTERNAL_KEY);
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.body, { booked: 3, confirmed: 1, attended: 1, noShow: 1, cancelled: 1, total: 4 });

  const active = await request(app).get(`/internal/donors/${donor.id}/active-bookings`)
    .set('x-internal-key', INTERNAL_KEY);
  assert.equal(active.status, 200);
  assert.equal(active.body.count, 1, 'the confirmed reminder booking is still active');

  const daily = await request(app).post('/internal/reminders/daily').set('x-internal-key', INTERNAL_KEY)
    .send({ date: driveDate });
  assert.equal(daily.status, 200);
  assert.equal(daily.body.date, driveDate);
  assert.equal(daily.body.skipped, 1);

  const cancellations = await request(app).post(`/internal/drives/${driveId}/cancellations`)
    .set('x-internal-key', INTERNAL_KEY).send({});
  assert.equal(cancellations.status, 200);
  assert.equal(cancellations.body.driveId, driveId);
});

process.on('beforeExit', () => cleanupSqlite(settings.sqlitePath, store));
