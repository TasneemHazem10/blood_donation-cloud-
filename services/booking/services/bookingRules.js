'use strict';

const { badRequest, conflict, forbidden, notFound } = require('../../../shared/errors');
const { isDate } = require('../../../shared/validate');

const STATUSES = ['confirmed', 'cancelled', 'attended', 'no_show'];
const ACTIVE = 'confirmed';

// '__' is URL-safe and passes the shared id validator; ':' did not.
function bookingKey(driveId, donorId) { return `${driveId}__${donorId}`; }

function assertBookable(drive, eligibility, date) {
  if (!drive) throw notFound('Drive not found');
  if (drive.status !== 'scheduled') throw conflict('This drive is not accepting bookings');
  if (!isDate(drive.date)) throw badRequest('Drive date is invalid');
  if (drive.date < date) throw conflict('The drive date has passed');
  if (!eligibility || !eligibility.eligible) {
    throw conflict((eligibility && eligibility.reason) || 'You are not eligible to donate on that date');
  }
}

function assertCanCancel(booking, user) {
  if (!booking) throw notFound('Booking not found');
  const owner = booking.donorId === user.id || (user.role === 'organizer' && booking.organizerId === user.id);
  if (!owner) throw forbidden('This booking belongs to another account');
  if (booking.status !== ACTIVE) throw conflict(`Booking is already ${booking.status}`);
}

function assertCanCheckIn(booking, user) {
  if (!booking) throw notFound('Booking not found');
  if (user.role !== 'organizer' || booking.organizerId !== user.id) {
    throw forbidden('Only the organizer of this drive can check donors in');
  }
  if (!['confirmed', 'attended', 'no_show'].includes(booking.status)) {
    throw conflict('A cancelled booking cannot be checked in');
  }
}

function countStats(bookings, driveId) {
  const rows = bookings.filter((booking) => booking.driveId === driveId);
  return {
    // Total reservations that were not cancelled, including check-ins.
    booked: rows.filter((row) => row.status !== 'cancelled').length,
    confirmed: rows.filter((row) => row.status === ACTIVE).length,
    attended: rows.filter((row) => row.status === 'attended').length,
    noShow: rows.filter((row) => row.status === 'no_show').length,
    cancelled: rows.filter((row) => row.status === 'cancelled').length,
    total: rows.length
  };
}

function tomorrow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  STATUSES, ACTIVE, bookingKey, assertBookable, assertCanCancel,
  assertCanCheckIn, countStats, tomorrow
};
