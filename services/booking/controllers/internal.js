'use strict';

const { getStore, now } = require('../../../shared/context');
const { ok } = require('../../../shared/http');
const { idParam } = require('../../../shared/validate');
const { sendEmail } = require('../../../shared/external/email');
const rules = require('../services/bookingRules');
const templates = require('../services/templates');
const { sendForDate } = require('./reminders');

const store = () => getStore();

async function stats(ctx) {
  const driveId = idParam(ctx.params);
  return ok(rules.countStats(await store().all('bdo_bookings'), driveId));
}

async function cancelDriveBookings(ctx) {
  const driveId = idParam(ctx.params);
  const rows = (await store().search('bdo_bookings', 'driveId', driveId))
    .filter((booking) => booking.status === 'confirmed');
  let cancelled = 0;
  let released = 0;
  for (const booking of rows) {
    const updated = await store().cas('bdo_bookings', booking.id, {
      status: 'cancelled', cancelledAt: now(), cancellationReason: 'drive_cancelled'
    }, { status: 'confirmed' });
    if (!updated) continue;
    cancelled += 1;
    try {
      await callRelease(booking);
      released += 1;
    } catch (error) {
      console.error('DRIVE_CANCEL_SEAT_RELEASE_FAILED', error.message);
    }
    try {
      await sendEmail({
        to: booking.donorEmail,
        name: booking.donorName,
        ...templates.cancellation({ ...booking, status: 'cancelled' })
      });
    } catch (error) {
      console.error('DRIVE_CANCEL_EMAIL_FAILED', error.message);
    }
  }
  return ok({ driveId, cancelled, released });
}

async function callRelease(booking) {
  const { callService } = require('../../../shared/serviceClient');
  return callService('drive', 'DELETE', `/internal/drives/${booking.driveId}/slots/${booking.slotId}/reservation`, { body: {} });
}

async function activeBookings(ctx) {
  const donorId = idParam(ctx.params);
  const date = new Date().toISOString().slice(0, 10);
  const rows = (await store().search('bdo_bookings', 'donorId', donorId))
    .filter((booking) => booking.status === 'confirmed' && booking.driveDate >= date);
  return ok({ count: rows.length, bookings: rows });
}

// Called by the EventBridge/Cloudflare cron rule with the internal key.
async function dailyReminders(ctx) {
  const date = ctx.body && ctx.body.date ? ctx.body.date : rules.tomorrow();
  return ok(await sendForDate(date));
}

module.exports = { stats, cancelDriveBookings, activeBookings, dailyReminders };
