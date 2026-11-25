'use strict';

const { getStore, now } = require('../../../shared/context');
const { badRequest, conflict, forbidden, notFound } = require('../../../shared/errors');
const { ok, created, noContent } = require('../../../shared/http');
const { idParam, stringField } = require('../../../shared/validate');
const { callService } = require('../../../shared/serviceClient');
const { notify } = require('../services/notifications');
const templates = require('../services/templates');
const rules = require('../services/bookingRules');

const store = () => getStore();
const today = () => new Date().toISOString().slice(0, 10);

function safeId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@+-]{1,160}$/.test(value)) throw badRequest(`${field} is not valid`);
  return value;
}

async function createBooking(ctx) {
  const body = ctx.body || {};
  const driveId = safeId(body.driveId, 'driveId');
  const slotId = safeId(body.slotId, 'slotId');
  const donorId = ctx.user.id;
  const date = today();

  const drive = await callService('drive', 'GET', `/internal/drives/${driveId}`);
  const eligibility = await callService('donor', 'GET', `/internal/donors/${donorId}/eligibility`, { query: { date: drive.date } });
  rules.assertBookable(drive, eligibility, date);

  const slot = drive.slots && drive.slots.find((item) => item.id === slotId);
  if (!slot) throw conflict('Slot not found on this drive');

  const key = rules.bookingKey(driveId, donorId);
  const existing = await store().get('bdo_bookings', key);
  if (existing && ['confirmed', 'attended'].includes(existing.status)) {
    throw conflict('You already have a booking for this drive');
  }

  await callService('drive', 'POST', `/internal/drives/${driveId}/slots/${slotId}/reservation`, { body: {} });
  const release = async () => {
    await callService('drive', 'DELETE', `/internal/drives/${driveId}/slots/${slotId}/reservation`, { body: {} })
      .catch((error) => console.error('SEAT_RELEASE_FAILED', error.message));
  };

  const booking = {
    id: key,
    driveId,
    slotId,
    donorId,
    organizerId: drive.organizerId,
    driveTitle: drive.title,
    driveDate: drive.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    venue: drive.venue,
    donorName: eligibility.donor ? eligibility.donor.name : ctx.user.name,
    donorEmail: eligibility.donor ? eligibility.donor.email : ctx.user.email,
    bloodType: eligibility.donor ? eligibility.donor.bloodType : null,
    status: rules.ACTIVE,
    createdAt: now()
  };

  let saved;
  try {
    // insert() is conditional in every driver: two concurrent requests cannot
    // both create the same booking. A cancelled/no-show record is reactivated
    // with a CAS so its history is preserved.
    saved = await store().insert('bdo_bookings', booking);
    if (!saved) {
      const previous = await store().get('bdo_bookings', key);
      if (previous && ['confirmed', 'attended'].includes(previous.status)) {
        throw conflict('You already have a booking for this drive');
      }
      saved = previous
        ? await store().cas('bdo_bookings', key, {
          ...booking, status: rules.ACTIVE, createdAt: previous.createdAt || booking.createdAt, rebookedAt: now()
        }, { status: previous.status })
        : null;
    }
    if (!saved) throw conflict('Booking state changed. Please refresh and try again.');
  } catch (error) {
    await release();
    throw error;
  }
  await notify(saved, templates.confirmation(saved), 'confirmation');
  return created({ booking: saved, message: 'Seat reserved. Confirmation email recorded.' });
}

async function myBookings(ctx) {
  const rows = (await store().search('bdo_bookings', 'donorId', ctx.user.id))
    .sort((a, b) => a.driveDate.localeCompare(b.driveDate));
  return ok({ count: rows.length, bookings: rows });
}

async function driveBookings(ctx) {
  const driveId = idParam(ctx.query, 'driveId');
  if (ctx.user.role !== 'organizer') throw forbidden('Only an organizer can view a drive booking list');
  const drive = await callService('drive', 'GET', `/internal/drives/${driveId}`);
  if (drive.organizerId !== ctx.user.id) throw forbidden('This drive belongs to another organizer');
  const rows = (await store().search('bdo_bookings', 'driveId', driveId))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return ok({ count: rows.length, bookings: rows });
}

async function cancelBooking(ctx) {
  const id = idParam(ctx.params);
  const booking = await store().get('bdo_bookings', id);
  rules.assertCanCancel(booking, ctx.user);
  const updated = await store().cas('bdo_bookings', id, { status: 'cancelled', cancelledAt: now() }, { status: 'confirmed' });
  if (!updated) throw conflict('Booking status changed. Please refresh and try again.');
  await callService('drive', 'DELETE', `/internal/drives/${booking.driveId}/slots/${booking.slotId}/reservation`, { body: {} })
    .catch((error) => console.error('SEAT_RELEASE_FAILED', error.message));
  await notify(updated, templates.cancellation(updated), 'cancellation');
  return ok({ booking: updated, message: 'Booking cancelled and seat released.' });
}

async function checkIn(ctx) {
  const id = idParam(ctx.params);
  const outcome = ctx.body && ctx.body.outcome;
  if (!rules.STATUSES.includes(outcome) || !['attended', 'no_show'].includes(outcome)) {
    throw badRequest('outcome must be attended or no_show');
  }
  const booking = await store().get('bdo_bookings', id);
  rules.assertCanCheckIn(booking, ctx.user);
  if (booking.status === outcome) return ok({ booking, message: 'Check-in was already recorded.' });

  // Win the status transition first. Recording a donation before the CAS can
  // leave a donation behind when another organizer checks the donor in first.
  const updated = await store().cas('bdo_bookings', id, { status: outcome, checkedInAt: now() }, { status: 'confirmed' });
  if (!updated) throw conflict('Booking is no longer confirmed');

  if (outcome === 'attended') {
    try {
      await callService('donor', 'POST', '/internal/donations', {
        body: { donationId: booking.id, donorId: booking.donorId, driveId: booking.driveId, date: booking.driveDate }
      });
    } catch (error) {
      // Compensate so the booking is not marked attended without its donation.
      await store().cas('bdo_bookings', id, { status: 'confirmed', checkedInAt: null }, { status: outcome })
        .catch((casError) => console.error('CHECKIN_ROLLBACK_FAILED', casError.message));
      throw error;
    }
  }
  return ok({ booking: updated, message: outcome === 'attended' ? 'Attendance and donation recorded.' : 'Marked as no-show.' });
}

module.exports = { createBooking, myBookings, driveBookings, cancelBooking, checkIn };
