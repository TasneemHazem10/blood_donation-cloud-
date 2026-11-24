'use strict';

const assert = require('node:assert/strict');
const { setupTestEnv, futureDate, daysAgoText } = require('./helpers/env');
const { check } = require('./helpers/harness');

setupTestEnv('rules');

const driveRules = require('../services/drive/services/driveRules');
const eligibility = require('../services/donor/services/eligibility');
const bookingRules = require('../services/booking/services/bookingRules');

check('SR01', 'drive validation accepts and normalises a valid drive', () => {
  const input = driveRules.validateDriveInput({
    title: '  Community Drive  ',
    venue: '  City Hall ',
    city: ' Kuwait ',
    date: futureDate(7),
    description: '  Bring ID '
  });
  assert.equal(input.title, 'Community Drive');
  assert.equal(input.venue, 'City Hall');
  assert.equal(input.city, 'Kuwait');
  assert.equal(input.description, 'Bring ID');
});

check('SR02', 'drive validation rejects bad title, date and description', () => {
  const base = { title: 'Valid Drive', venue: 'City Hall', city: 'Kuwait', date: futureDate(7) };
  assert.throws(() => driveRules.validateDriveInput({ ...base, title: 'ab' }), /title must be 3-120/);
  assert.throws(() => driveRules.validateDriveInput({ ...base, date: '2026-02-30' }), /date must be a valid date/);
  assert.throws(() => driveRules.validateDriveInput({ ...base, description: 'x'.repeat(1001) }), /description is too long/);
});

check('SR03', 'slot validation accepts ranges and rejects bad times/capacity', () => {
  assert.deepEqual(driveRules.validateSlotInput({ startTime: '09:00', endTime: '11:30', capacity: '4' }),
    { startTime: '09:00', endTime: '11:30', capacity: 4 });
  assert.throws(() => driveRules.validateSlotInput({ startTime: '25:00', endTime: '26:00', capacity: 4 }), /Times must be HH:MM/);
  assert.throws(() => driveRules.validateSlotInput({ startTime: '11:00', endTime: '11:00', capacity: 4 }), /End time must be after/);
  assert.throws(() => driveRules.validateSlotInput({ startTime: '09:00', endTime: '11:00', capacity: 0 }), /capacity must be an integer/);
});

check('SR04', 'slot overlap detection ignores non-overlaps and honours ignoreId', () => {
  const slots = [{ id: 's1', startTime: '09:00', endTime: '11:00' }];
  assert.doesNotThrow(() => driveRules.assertNoOverlap(slots, { startTime: '11:00', endTime: '12:00' }));
  assert.throws(() => driveRules.assertNoOverlap(slots, { startTime: '10:30', endTime: '12:00' }), /Time overlaps with slot 09:00-11:00/);
  assert.doesNotThrow(() => driveRules.assertNoOverlap(slots, { startTime: '10:00', endTime: '12:00' }, 's1'));
});

check('SR05', 'drive filters apply city, status and date range', () => {
  const drives = [
    { id: 'd1', city: 'Kuwait City', status: 'scheduled', date: '2026-12-01' },
    { id: 'd2', city: 'Salmiya', status: 'completed', date: '2026-12-10' },
    { id: 'd3', city: 'kuwait', status: 'scheduled', date: '2026-11-01' }
  ];
  assert.deepEqual(driveRules.filterDrives(drives, { city: 'kuwait' }).map((d) => d.id), ['d1', 'd3']);
  assert.deepEqual(driveRules.filterDrives(drives, { status: 'scheduled' }).map((d) => d.id), ['d1', 'd3']);
  assert.deepEqual(driveRules.filterDrives(drives, { dateFrom: '2026-12-01', dateTo: '2026-12-10' }).map((d) => d.id), ['d1', 'd2']);
  assert.throws(() => driveRules.filterDrives(drives, { status: 'unknown' }), /status filter is not valid/);
});

check('SR06', 'nearby filter uses haversine distance and radius', () => {
  const drives = [
    { id: 'near', lat: 29.37, lon: 47.98 },
    { id: 'far', lat: 33.0, lon: 44.0 },
    { id: 'unknown', lat: null, lon: null }
  ];
  const result = driveRules.filterNear(drives, { lat: 29.37, lon: 47.98 }, 10);
  assert.deepEqual(result.map((d) => d.id), ['near']);
  assert.ok(result[0].distanceKm >= 0 && result[0].distanceKm < 1);
  assert.throws(() => driveRules.filterNear(drives, { lat: 29.37, lon: 47.98 }, 600), /radius must be between 1 and 500/);
});

check('SR07', 'report build computes rates from booking stats', () => {
  const report = driveRules.buildReport(
    { id: 'drv1', title: 'Drive', date: futureDate(1) },
    [{ capacity: 6 }, { capacity: 4 }],
    { booked: 5, attended: 3, noShow: 1, cancelled: 1 }
  );
  assert.equal(report.capacity, 10);
  assert.equal(report.slots, 2);
  assert.equal(report.fillRate, 50);
  assert.equal(report.turnoutRate, 60);
  assert.equal(report.noShowRate, 20);
  assert.equal(report.driveId, 'drv1');
});

check('SR08', 'drive ownership, editability and existence guards throw correctly', () => {
  const drive = { id: 'drv1', organizerId: 'org1', status: 'scheduled' };
  assert.doesNotThrow(() => driveRules.assertOwner(drive, { id: 'org1' }));
  assert.throws(() => driveRules.assertOwner(drive, { id: 'org2' }), /Only the organizer/);
  assert.throws(() => driveRules.assertEditable({ ...drive, status: 'cancelled' }), /cannot be edited/);
  assert.throws(() => driveRules.requireDrive(null), /Drive not found/);
  assert.equal(driveRules.requireDrive(drive), drive);
});

check('SR09', 'eligibility accepts an adult donor with sufficient weight', () => {
  const result = eligibility.evaluate({ birthYear: 1990, weightKg: 70 }, '2026-11-24');
  assert.equal(result.eligible, true);
  assert.equal(result.age, 36);
  assert.equal(result.weightKg, 70);
  assert.equal(result.intervalDays, 56);
});

check('SR10', 'eligibility enforces age and weight boundaries', () => {
  assert.match(eligibility.evaluate({ birthYear: 2010, weightKg: 70 }, '2026-11-24').reason, /between 18 and 65/);
  assert.match(eligibility.evaluate({ birthYear: 1950, weightKg: 70 }, '2026-11-24').reason, /between 18 and 65/);
  assert.match(eligibility.evaluate({ birthYear: 1990, weightKg: 49 }, '2026-11-24').reason, /at least 50 kg/);
  assert.equal(eligibility.evaluate({ birthYear: 2010, weightKg: 60 }, '2026-11-24').nextEligibleDate, null);
});

check('SR11', 'eligibility enforces the 56-day interval and deferral', () => {
  const last = daysAgoText(40);
  const short = eligibility.evaluate({ birthYear: 1990, weightKg: 65, lastDonationDate: last }, '2026-11-24');
  assert.equal(short.eligible, false);
  assert.match(short.reason, /At least 56 days/);
  assert.equal(short.nextEligibleDate, eligibility.addDays(last, 56));

  const ok = eligibility.evaluate({ birthYear: 1990, weightKg: 65, lastDonationDate: daysAgoText(56) }, '2026-11-24');
  assert.equal(ok.eligible, true);

  const deferred = eligibility.evaluate({ birthYear: 1990, weightKg: 65, deferredUntil: futureDate(10) }, '2026-11-24');
  assert.equal(deferred.eligible, false);
  assert.match(deferred.reason, /deferred until/);
  assert.equal(deferred.nextEligibleDate, futureDate(10));
});

check('SR12', 'eligibility rejects invalid dates and missing profiles', () => {
  assert.throws(() => eligibility.evaluate({ birthYear: 1990, weightKg: 70 }, '24-11-2026'), /date must be a valid date/);
  const missing = eligibility.evaluate(null, '2026-11-24');
  assert.equal(missing.eligible, false);
  assert.match(missing.reason, /profile not found/);
});

check('SR13', 'profile validation covers full and partial updates', () => {
  const full = eligibility.validateProfile({ bloodType: 'O+', weightKg: '62', birthYear: 1990, phone: ' 555 ' });
  assert.deepEqual(full, { bloodType: 'O+', weightKg: 62, birthYear: 1990, phone: '555' });
  assert.deepEqual(eligibility.validateProfile({ weightKg: 70 }, true), { weightKg: 70 });
  assert.throws(() => eligibility.validateProfile({ bloodType: 'Z+', weightKg: 70, birthYear: 1990 }), /bloodType must be one of/);
  assert.throws(() => eligibility.validateProfile({ bloodType: 'O+', weightKg: 20, birthYear: 1990 }), /weightKg must be between/);
  assert.throws(() => eligibility.validateProfile({ bloodType: 'O+', weightKg: 70, birthYear: 1800 }), /birthYear must be a valid year/);
});

check('SR14', 'booking key and status constants are stable', () => {
  assert.equal(bookingRules.bookingKey('drv1', 'donor@example.org'), 'drv1__donor@example.org');
  assert.deepEqual(bookingRules.STATUSES, ['confirmed', 'cancelled', 'attended', 'no_show']);
  assert.equal(bookingRules.ACTIVE, 'confirmed');
});

check('SR15', 'bookable guard checks status, date and eligibility', () => {
  const date = '2026-11-24';
  assert.doesNotThrow(() => bookingRules.assertBookable({ status: 'scheduled', date: '2026-12-01' }, { eligible: true }, date));
  assert.throws(() => bookingRules.assertBookable({ status: 'cancelled', date: '2026-12-01' }, { eligible: true }, date), /not accepting bookings/);
  assert.throws(() => bookingRules.assertBookable({ status: 'scheduled', date: '2026-11-01' }, { eligible: true }, date), /date has passed/);
  assert.throws(() => bookingRules.assertBookable({ status: 'scheduled', date: '2026-12-01' }, { eligible: false, reason: 'Too young' }, date), /Too young/);
  assert.throws(() => bookingRules.assertBookable({ status: 'scheduled', date: 'not-a-date' }, { eligible: true }, date), /Drive date is invalid/);
});

check('SR16', 'cancel ownership and status guards', () => {
  const booking = { id: 'b1', donorId: 'donor1', organizerId: 'org1', status: 'confirmed' };
  assert.doesNotThrow(() => bookingRules.assertCanCancel(booking, { id: 'donor1', role: 'donor' }));
  assert.doesNotThrow(() => bookingRules.assertCanCancel(booking, { id: 'org1', role: 'organizer' }));
  assert.throws(() => bookingRules.assertCanCancel(booking, { id: 'donor2', role: 'donor' }), /belongs to another account/);
  assert.throws(() => bookingRules.assertCanCancel({ ...booking, status: 'cancelled' }, { id: 'donor1' }), /already cancelled/);
  assert.throws(() => bookingRules.assertCanCancel(null, { id: 'donor1' }), /Booking not found/);
});

check('SR17', 'check-in ownership and status guards', () => {
  const booking = { id: 'b1', donorId: 'donor1', organizerId: 'org1', status: 'confirmed' };
  assert.doesNotThrow(() => bookingRules.assertCanCheckIn(booking, { id: 'org1', role: 'organizer' }));
  assert.doesNotThrow(() => bookingRules.assertCanCheckIn({ ...booking, status: 'attended' }, { id: 'org1', role: 'organizer' }));
  assert.throws(() => bookingRules.assertCanCheckIn(booking, { id: 'donor1', role: 'donor' }), /Only the organizer/);
  assert.throws(() => bookingRules.assertCanCheckIn(booking, { id: 'org2', role: 'organizer' }), /Only the organizer/);
  assert.throws(() => bookingRules.assertCanCheckIn({ ...booking, status: 'cancelled' }, { id: 'org1', role: 'organizer' }), /cannot be checked in/);
});

check('SR18', 'booking statistics and tomorrow helper', () => {
  const bookings = [
    { driveId: 'd1', status: 'confirmed' },
    { driveId: 'd1', status: 'attended' },
    { driveId: 'd1', status: 'no_show' },
    { driveId: 'd1', status: 'cancelled' },
    { driveId: 'd2', status: 'confirmed' }
  ];
  assert.deepEqual(bookingRules.countStats(bookings, 'd1'),
    { booked: 3, confirmed: 1, attended: 1, noShow: 1, cancelled: 1, total: 4 });
  assert.equal(bookingRules.tomorrow(), futureDate(1));
});
