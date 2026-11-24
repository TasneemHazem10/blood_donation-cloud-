'use strict';

const { getStore, now } = require('../../../shared/context');
const { newId } = require('../../../shared/crypto');
const { sendEmail } = require('../../../shared/external/email');

// Every email attempt is saved in the database so the UI and the report can
// show exactly what happened. Duplicate reminders are prevented by record id.
async function notify(booking, template, type) {
  const id = `${booking.id}#${type}#${newId('mail')}`;
  const record = {
    id,
    bookingId: booking.id,
    donorId: booking.donorId,
    driveId: booking.driveId,
    organizerId: booking.organizerId,
    type,
    to: booking.donorEmail,
    subject: template.subject,
    scheduledFor: now(),
    status: 'pending'
  };
  await getStore().put('bdo_reminders', record);
  try {
    const result = await sendEmail({ to: booking.donorEmail, name: booking.donorName, ...template });
    return await getStore().update('bdo_reminders', id, { status: result.status, provider: result.provider, messageId: result.messageId, sentAt: now() });
  } catch (error) {
    console.error('EMAIL_FAILED', error.message);
    return getStore().update('bdo_reminders', id, { status: 'failed', error: error.message.slice(0, 200), sentAt: now() });
  }
}

module.exports = { notify };
