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

const SENT_STATUSES = new Set(['sent', 'dev-log']);
const MAX_REMINDER_ATTEMPTS = 3;

// Shared by the organizer button and the daily scheduled cloud job.
// The reminder row is claimed with a conditional insert/CAS, so two concurrent
// runs cannot both send the same email. Failed rows are retried up to 3 times.
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
    const template = templates.reminder(booking);
    let claim = await store().insert('bdo_reminders', {
      id, bookingId: booking.id, donorId: booking.donorId, driveId: booking.driveId,
      organizerId: booking.organizerId, type: 'reminder', to: booking.donorEmail,
      subject: template.subject, scheduledFor: now(), status: 'pending', attempts: 1
    });

    if (!claim) {
      const existing = await store().get('bdo_reminders', id);
      const attempts = Number(existing && existing.attempts) || 1;
      if (!existing || SENT_STATUSES.has(existing.status) || existing.status === 'pending' || attempts >= MAX_REMINDER_ATTEMPTS) {
        skipped += 1;
        continue;
      }
      if (existing.status !== 'failed') { skipped += 1; continue; }
      claim = await store().cas('bdo_reminders', id, {
        status: 'pending', attempts: attempts + 1, claimedAt: now()
      }, { status: 'failed', attempts });
      if (!claim) { skipped += 1; continue; }
    }

    try {
      const result = await sendEmail({ to: booking.donorEmail, name: booking.donorName, ...template });
      await store().update('bdo_reminders', id, {
        status: result.status, provider: result.provider, messageId: result.messageId, sentAt: now()
      });
      sent += 1;
    } catch (error) {
      await store().update('bdo_reminders', id, {
        status: 'failed', error: error.message.slice(0, 200), sentAt: now(), attempts: claim.attempts
      });
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
