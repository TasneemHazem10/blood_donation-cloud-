'use strict';

// Business rules for drive management (Student 1).
const { badRequest, conflict, forbidden, notFound } = require('../../../shared/errors');
const { isDate, isTime } = require('../../../shared/validate');
const { distanceKm } = require('../../../shared/external/geo');

const STATUSES = ['scheduled', 'cancelled', 'completed'];

function assertOwner(drive, user) {
  if (drive.organizerId !== user.id) throw forbidden('Only the organizer who created this drive can change it');
}

function assertEditable(drive) {
  if (drive.status !== 'scheduled') throw conflict(`A ${drive.status} drive cannot be edited`);
}

function validateDriveInput(body) {
  const title = String(body.title || '').trim();
  const venue = String(body.venue || '').trim();
  const city = String(body.city || '').trim();
  if (title.length < 3 || title.length > 120) throw badRequest('title must be 3-120 characters');
  if (venue.length < 3 || venue.length > 160) throw badRequest('venue must be 3-160 characters');
  if (city.length < 2 || city.length > 80) throw badRequest('city must be 2-80 characters');
  if (!isDate(body.date)) throw badRequest('date must be a valid date in YYYY-MM-DD format');
  if (body.description !== undefined && String(body.description).length > 1000) throw badRequest('description is too long');
  return {
    title,
    venue,
    city,
    date: body.date,
    description: String(body.description || '').trim()
  };
}

function validateSlotInput(body) {
  const { startTime, endTime, capacity } = body;
  if (!isTime(startTime) || !isTime(endTime)) throw badRequest('Times must be HH:MM (24-hour)');
  if (startTime >= endTime) throw badRequest('End time must be after start time');
  const seats = Number(capacity);
  if (!Number.isInteger(seats) || seats < 1 || seats > 200) throw badRequest('capacity must be an integer from 1 to 200');
  return { startTime, endTime, capacity: seats };
}

function assertNoOverlap(slots, candidate, ignoreId = null) {
  const clash = slots.find((slot) => slot.id !== ignoreId
    && slot.startTime < candidate.endTime && candidate.startTime < slot.endTime);
  if (clash) throw conflict(`Time overlaps with slot ${clash.startTime}-${clash.endTime}`);
}

function filterDrives(drives, query) {
  let result = drives;
  if (query.city) {
    const city = String(query.city).toLowerCase();
    result = result.filter((drive) => drive.city.toLowerCase().includes(city));
  }
  if (query.status) {
    if (!STATUSES.includes(query.status)) throw badRequest('status filter is not valid');
    result = result.filter((drive) => drive.status === query.status);
  }
  if (query.dateFrom || query.dateTo) {
    if (query.dateFrom && !isDate(query.dateFrom)) throw badRequest('dateFrom must be YYYY-MM-DD');
    if (query.dateTo && !isDate(query.dateTo)) throw badRequest('dateTo must be YYYY-MM-DD');
    result = result.filter((drive) => (!query.dateFrom || drive.date >= query.dateFrom)
      && (!query.dateTo || drive.date <= query.dateTo));
  }
  return result;
}

function filterNear(drives, point, radiusKm) {
  const radius = Number(radiusKm || 25);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 500) throw badRequest('radius must be between 1 and 500 km');
  return drives
    .filter((drive) => Number.isFinite(drive.lat) && Number.isFinite(drive.lon))
    .map((drive) => ({ drive, distance: distanceKm(point.lat, point.lon, drive.lat, drive.lon) }))
    .filter((entry) => entry.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => ({ ...entry.drive, distanceKm: Math.round(entry.distance * 10) / 10 }));
}

function buildReport(drive, slots, stats) {
  const capacity = slots.reduce((total, slot) => total + Number(slot.capacity || 0), 0);
  const booked = stats.booked || 0;
  const attended = stats.attended || 0;
  const noShow = stats.noShow || 0;
  const cancelled = stats.cancelled || 0;
  return {
    driveId: drive.id,
    driveTitle: drive.title,
    date: drive.date,
    slots: slots.length,
    capacity,
    booked,
    attended,
    noShow,
    cancelled,
    fillRate: capacity ? Math.round((booked / capacity) * 1000) / 10 : 0,
    turnoutRate: booked ? Math.round((attended / booked) * 1000) / 10 : 0,
    noShowRate: booked ? Math.round((noShow / booked) * 1000) / 10 : 0,
    generatedAt: new Date().toISOString()
  };
}

function requireDrive(drive) {
  if (!drive) throw notFound('Drive not found');
  return drive;
}

module.exports = {
  STATUSES, assertOwner, assertEditable, validateDriveInput, validateSlotInput,
  assertNoOverlap, filterDrives, filterNear, buildReport, requireDrive
};
