'use strict';

const { config } = require('../../../shared/config');
const { getStore, now } = require('../../../shared/context');
const { badRequest, forbidden } = require('../../../shared/errors');
const { ok } = require('../../../shared/http');
const { isDate } = require('../../../shared/validate');
const { sendEmail } = require('../../../shared/external/email');
const rules = require('../services/bookingRules');
const templates = require('../services/templates');

const store = () => getStore();

// Shared by the organizer button and the daily scheduled cloud job.
// A booking/date key makes a repeated run skip emails already sent.
async function sendForDate(date, organizerId = null) {
  if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD');
  const bookings = (await store().all('bdo_bookings')).filter((booking) =>
    booking.status === 'confirmed' && booking.driveDate === date
    && (!organizerId || booking.organizerId === organizerId));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const booking of bookings) {
    const id = `${booking.id}#reminder#${date}`;
    if (await store().get('bdo_reminders', id)) { skipped += 1; continue; }
    await store().put('bdo_reminders', {
      id, bookingId: booking.id, donorId: booking.donorId, driveId: booking.driveId,
      organizerId: booking.organizerId, type: 'reminder', to: booking.donorEmail,
      subject: templates.reminder(booking).subject, scheduledFor: now(), status: 'pending'
    });
    try {
      const template = templates.reminder(booking);
      const result = await sendEmail({ to: booking.donorEmail, name: booking.donorName, ...template });
      await store().update('bdo_reminders', id, {
        status: result.status, provider: result.provider, messageId: result.messageId, sentAt: now()
      });
      sent += 1;
    } catch (error) {
      await store().update('bdo_reminders', id, { status: 'failed', error: error.message.slice(0, 200), sentAt: now() });
      failed += 1;
    }
  }
  return { date, eligible: bookings.length, sent, skipped, failed, emailMode: config().emailMode };
}

async function sendReminders(ctx) {
  if (ctx.user.role !== 'organizer') throw forbidden('Only an organizer can send reminders');
  const date = (ctx.body && ctx.body.date) || ctx.query.date || rules.tomorrow();
  return ok(await sendForDate(date, ctx.user.id));
}

async function listReminders(ctx) {
  if (ctx.user.role !== 'organizer') throw forbidden('Only an organizer can view the email log');
  const rows = (await store().all('bdo_reminders'))
    .filter((row) => row.organizerId === ctx.user.id)
    .sort((a, b) => String(b.scheduledFor).localeCompare(String(a.scheduledFor)));
  return ok({ count: rows.length, reminders: rows });
}

module.exports = { sendReminders, listReminders, sendForDate };
