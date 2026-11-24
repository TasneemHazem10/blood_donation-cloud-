'use strict';

const { route } = require('../../shared/router');
const bookings = require('./controllers/bookings');
const reminders = require('./controllers/reminders');
const internal = require('./controllers/internal');
const { ok } = require('../../shared/http');
const { now } = require('../../shared/context');

module.exports = [
  route('GET', '/api/health/booking', () => ok({ status: 'ok', service: 'booking', time: now() })),
  route('POST', '/api/bookings', bookings.createBooking, { auth: true, roles: ['donor'] }),
  route('GET', '/api/bookings/mine', bookings.myBookings, { auth: true }),
  route('GET', '/api/bookings', bookings.driveBookings, { auth: true, roles: ['organizer'] }),
  route('POST', '/api/bookings/:id/cancel', bookings.cancelBooking, { auth: true }),
  route('PATCH', '/api/bookings/:id/check-in', bookings.checkIn, { auth: true, roles: ['organizer'] }),
  route('POST', '/api/reminders/send', reminders.sendReminders, { auth: true, roles: ['organizer'] }),
  route('GET', '/api/reminders', reminders.listReminders, { auth: true, roles: ['organizer'] }),

  route('GET', '/internal/drives/:id/stats', internal.stats, { internal: true }),
  route('POST', '/internal/drives/:id/cancellations', internal.cancelDriveBookings, { internal: true }),
  route('GET', '/internal/donors/:id/active-bookings', internal.activeBookings, { internal: true }),
  route('POST', '/internal/reminders/daily', internal.dailyReminders, { internal: true })
];
