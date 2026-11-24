'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after } = require('node:test');
const request = require('supertest');
const { setupTestEnv, cleanupSqlite, futureDate } = require('./helpers/env');
const { check } = require('./helpers/harness');

// Placeholder URLs are installed before any application module is loaded;
// after the in-process servers listen they are replaced with real ports.
const settings = setupTestEnv('integration');

const { createSqliteStore } = require('../shared/store/sqlite');
const { setStore } = require('../shared/context');
const { createApp: createDriveApp } = require('../services/drive/app');
const { createApp: createDonorApp } = require('../services/donor/app');
const { createApp: createBookingApp } = require('../services/booking/app');

const store = setStore(createSqliteStore(settings.sqlitePath));
const donorApp = createDonorApp();
donorApp.set('trust proxy', true);
const driveApp = createDriveApp();
const bookingApp = createBookingApp();

const servers = [];
async function listen(app, name) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let driveBase;
let donorBase;
let bookingBase;
let driveDate;

let ipSeq = 0;
function donorClient() {
  ipSeq += 1;
  return request.agent(donorBase).set('X-Forwarded-For', `10.2.${ipSeq}.1`);
}

async function register(seq, body) {
  const res = await donorClient().post('/api/auth/register').send(body);
  assert.equal(res.status, 201, `${body.email}: ${JSON.stringify(res.body)}`);
  return res.body;
}

function donorBody(email, birthYear = 1990) {
  return {
    name: `Donor ${email}`,
    email,
    password: 'passport123',
    bloodType: 'O+',
    weightKg: 68,
    birthYear,
    phone: '555000111'
  };
}

after(async () => {
  for (const server of servers) {
    await new Promise((resolve) => server.close(resolve));
  }
  cleanupSqlite(settings.sqlitePath, store);
});

check('IN01', 'three services complete a real HTTP booking-to-report lifecycle', async () => {
  driveBase = await listen(driveApp, 'drive');
  donorBase = await listen(donorApp, 'donor');
  bookingBase = await listen(bookingApp, 'booking');
  process.env.DRIVE_SERVICE_URL = driveBase;
  process.env.DONOR_SERVICE_URL = donorBase;
  process.env.BOOKING_SERVICE_URL = bookingBase;
  driveDate = futureDate(10);

  for (const [name, base] of [['drive', driveBase], ['donor', donorBase], ['booking', bookingBase]]) {
    const health = await request(base).get(`/api/health/${name}`);
    assert.equal(health.status, 200);
    assert.equal(health.body.service, name);
  }

  const organizer = await register(1, {
    name: 'Integration Organizer', email: 'org@integration.test', password: 'passport123',
    role: 'organizer', inviteCode: 'blood2026'
  });
  const donor1 = await register(2, donorBody('donor1@integration.test'));
  const donor2 = await register(3, donorBody('donor2@integration.test'));
  const donor3 = await register(4, donorBody('donor3@integration.test'));
  const donor4 = await register(5, donorBody('donor4@integration.test'));
  const ineligible = await register(6, donorBody('young@integration.test', 2010));
  const orgToken = organizer.token;

  const driveRes = await request(driveBase).post('/api/drives').set('Authorization', `Bearer ${orgToken}`).send({
    title: 'Integration Drive', venue: 'City Hall', city: 'Kuwait City',
    date: driveDate, description: 'End-to-end scenario'
  });
  assert.equal(driveRes.status, 201, JSON.stringify(driveRes.body));
  const id = driveRes.body.id;

  const slotRes = await request(driveBase).post(`/api/drives/${id}/slots`)
    .set('Authorization', `Bearer ${orgToken}`)
    .send({ startTime: '09:00', endTime: '12:00', capacity: 3 });
  assert.equal(slotRes.status, 201, JSON.stringify(slotRes.body));
  const slotId = slotRes.body.id;

  const listed = await request(driveBase).get('/api/drives').query({ city: 'kuwait', status: 'scheduled' });
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.drives[0].slots[0].available, 3);

  const book = (token) => request(bookingBase).post('/api/bookings')
    .set('Authorization', `Bearer ${token}`).send({ driveId: id, slotId });

  const first = await book(donor1.token);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const double = await book(donor1.token);
  assert.equal(double.status, 409);
  const second = await book(donor2.token);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const third = await book(donor3.token);
  assert.equal(third.status, 201, JSON.stringify(third.body));

  const ineligibleRes = await book(ineligible.token);
  assert.equal(ineligibleRes.status, 409);
  assert.match(ineligibleRes.body.error.message, /between 18 and 65|not eligible/i);

  const full = await book(donor4.token);
  assert.equal(full.status, 409);
  assert.match(full.body.error.message, /slot is full/);

  const booking1Key = first.body.booking.id;
  const booking2Key = second.body.booking.id;
  const booking3Key = third.body.booking.id;

  const driveBookings = await request(bookingBase).get('/api/bookings').query({ driveId: id })
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(driveBookings.status, 200);
  assert.equal(driveBookings.body.count, 3);

  const mine = await request(bookingBase).get('/api/bookings/mine')
    .set('Authorization', `Bearer ${donor1.token}`);
  assert.equal(mine.body.count, 1);
  assert.equal(mine.body.bookings[0].id, booking1Key);

  const firstReminder = await request(bookingBase).post('/api/reminders/send')
    .set('Authorization', `Bearer ${orgToken}`).send({ date: driveDate });
  assert.equal(firstReminder.status, 200);
  assert.equal(firstReminder.body.sent, 3);
  const repeatReminder = await request(bookingBase).post('/api/reminders/send')
    .set('Authorization', `Bearer ${orgToken}`).send({ date: driveDate });
  assert.equal(repeatReminder.body.skipped, 3);

  const reminderLog = await request(bookingBase).get('/api/reminders')
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(reminderLog.status, 200);
  assert.ok(reminderLog.body.reminders.some((row) => row.type === 'reminder' && row.status === 'dev-log'));

  const reportBefore = await request(driveBase).get(`/api/drives/${id}/report`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(reportBefore.status, 200, JSON.stringify(reportBefore.body));
  assert.equal(reportBefore.body.capacity, 3);
  assert.equal(reportBefore.body.booked, 3);
  assert.equal(reportBefore.body.fillRate, 100);

  const donorReport = await request(driveBase).get(`/api/drives/${id}/report`)
    .set('Authorization', `Bearer ${donor1.token}`);
  assert.equal(donorReport.status, 403);

  const attended = await request(bookingBase).patch(`/api/bookings/${encodeURIComponent(booking1Key)}/check-in`)
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'attended' });
  assert.equal(attended.status, 200, JSON.stringify(attended.body));
  const noShow = await request(bookingBase).patch(`/api/bookings/${encodeURIComponent(booking2Key)}/check-in`)
    .set('Authorization', `Bearer ${orgToken}`).send({ outcome: 'no_show' });
  assert.equal(noShow.status, 200);

  const donations = await donorClient().get('/api/donors/me/donations')
    .set('Authorization', `Bearer ${donor1.token}`);
  assert.equal(donations.body.count, 1);
  assert.equal(donations.body.donations[0].date, driveDate);
  const noDonations = await donorClient().get('/api/donors/me/donations')
    .set('Authorization', `Bearer ${donor2.token}`);
  assert.equal(noDonations.body.count, 0);

  const reportAfter = await request(driveBase).get(`/api/drives/${id}/report`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(reportAfter.body.booked, 3);
  assert.equal(reportAfter.body.attended, 1);
  assert.equal(reportAfter.body.noShow, 1);

  const blockedDelete = await request(driveBase).delete(`/api/drives/${id}`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(blockedDelete.status, 409);

  const blockedDonorDelete = await donorClient().delete('/api/donors/me')
    .set('Authorization', `Bearer ${donor3.token}`);
  assert.equal(blockedDonorDelete.status, 409);

  const cancelled = await request(bookingBase).post(`/api/bookings/${encodeURIComponent(booking3Key)}/cancel`)
    .set('Authorization', `Bearer ${donor3.token}`);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const afterCancel = await request(driveBase).get(`/api/drives/${id}`);
  assert.equal(afterCancel.body.slots[0].booked, 2);
  assert.equal(afterCancel.body.slots[0].available, 1);

  const donorDeleted = await donorClient().delete('/api/donors/me')
    .set('Authorization', `Bearer ${donor3.token}`);
  assert.equal(donorDeleted.status, 204);

  const driveDeleted = await request(driveBase).delete(`/api/drives/${id}`)
    .set('Authorization', `Bearer ${orgToken}`);
  assert.equal(driveDeleted.status, 204, JSON.stringify(driveDeleted.body));
  const gone = await request(driveBase).get(`/api/drives/${id}`);
  assert.equal(gone.status, 404);
});

check('IN02', 'real HTTP error cases cover 400/401/403/404/409', async () => {
  const organizerToken = (await donorClient().post('/api/auth/login')
    .send({ email: 'org@integration.test', password: 'passport123' })).body.token;

  const noToken = await request(driveBase).post('/api/drives').send({ title: 'No auth' });
  assert.equal(noToken.status, 401);

  const noTokenBooking = await request(bookingBase).post('/api/bookings').send({});
  assert.equal(noTokenBooking.status, 401);

  const unknown = await request(driveBase).get('/api/drives/drv_unknown_id');
  assert.equal(unknown.status, 404);

  const freshDrive = await request(driveBase).post('/api/drives').set('Authorization', `Bearer ${organizerToken}`)
    .send({ title: 'Second Drive', venue: 'School', city: 'Kuwait', date: driveDate });
  assert.equal(freshDrive.status, 201);

  const badSlot = await request(driveBase).post(`/api/drives/${freshDrive.body.id}/slots`)
    .set('Authorization', `Bearer ${organizerToken}`)
    .send({ startTime: '25:00', endTime: '26:00', capacity: 3 });
  assert.equal(badSlot.status, 400);

  const duplicate = await donorClient().post('/api/auth/register').send(donorBody('donor1@integration.test'));
  assert.equal(duplicate.status, 409);

  const badInvite = await donorClient().post('/api/auth/register').send({
    name: 'Bad Organizer', email: 'badorg@integration.test', password: 'passport123',
    role: 'organizer', inviteCode: 'nope'
  });
  assert.equal(badInvite.status, 409);

  const badLogin = await donorClient().post('/api/auth/login')
    .send({ email: 'donor1@integration.test', password: 'wrongpass' });
  assert.equal(badLogin.status, 401);

  const donorToken = (await donorClient().post('/api/auth/login')
    .send({ email: 'donor1@integration.test', password: 'passport123' })).body.token;

  const donorList = await request(bookingBase).get('/api/bookings').query({ driveId: 'drv_unknown_id' })
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorList.status, 403);

  const donorReminders = await request(bookingBase).get('/api/reminders')
    .set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorReminders.status, 403);

  const organizerList = await request(bookingBase).get('/api/bookings').query({ driveId: 'drv_unknown_id' })
    .set('Authorization', `Bearer ${organizerToken}`);
  assert.equal(organizerList.status, 404);
});
