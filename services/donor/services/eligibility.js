'use strict';

// Business rules for donor eligibility (Student 2).
const { config } = require('../../../shared/config');
const { badRequest } = require('../../../shared/errors');
const { isDate } = require('../../../shared/validate');

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function evaluate(donor, date) {
  if (!isDate(date)) throw badRequest('date must be a valid date in YYYY-MM-DD format');
  const interval = Math.max(1, config().donationIntervalDays || 56);
  const birthYear = Number(donor && donor.birthYear);
  const age = birthYear ? Number(date.slice(0, 4)) - birthYear : null;
  const weight = Number(donor && donor.weightKg);
  const last = donor && donor.lastDonationDate;
  const elapsed = last ? daysBetween(last, date) : null;
  const deferredUntil = donor && donor.deferredUntil;
  let eligible = true;
  let reason = 'You meet the basic donation criteria';

  if (!donor) {
    eligible = false; reason = 'Donor profile not found';
  } else if (!birthYear || age < 18 || age > 65) {
    eligible = false; reason = 'Donors must be between 18 and 65 years old';
  } else if (!Number.isFinite(weight) || weight < 50) {
    eligible = false; reason = 'Donors must weigh at least 50 kg';
  } else if (elapsed !== null && elapsed < interval) {
    eligible = false; reason = `At least ${interval} days must pass after your last donation`;
  } else if (deferredUntil && date < deferredUntil) {
    eligible = false; reason = `Donation is deferred until ${deferredUntil}`;
  }

  let nextEligibleDate = date;
  if (!eligible) {
    if (!donor || !birthYear || age < 18) nextEligibleDate = null;
    else if (age > 65) nextEligibleDate = null;
    else if (!Number.isFinite(weight) || weight < 50) nextEligibleDate = null;
    else if (last && elapsed < interval) nextEligibleDate = addDays(last, interval);
    else if (deferredUntil && date < deferredUntil) nextEligibleDate = deferredUntil;
  }

  return {
    eligible,
    reason,
    nextEligibleDate,
    evaluatedOn: date,
    age,
    weightKg: Number.isFinite(weight) ? weight : null,
    lastDonationDate: last || null,
    intervalDays: interval
  };
}

function validateProfile(body, partial = false) {
  const result = {};
  const required = (field) => !partial || body[field] !== undefined;
  if (!body || typeof body !== 'object') throw badRequest('A JSON object body is required');
  if (required('bloodType')) {
    if (!BLOOD_TYPES.includes(body.bloodType)) throw badRequest(`bloodType must be one of ${BLOOD_TYPES.join(', ')}`);
    result.bloodType = body.bloodType;
  }
  if (required('weightKg')) {
    const weight = Number(body.weightKg);
    if (!Number.isFinite(weight) || weight < 30 || weight > 300) throw badRequest('weightKg must be between 30 and 300');
    result.weightKg = weight;
  }
  if (required('birthYear')) {
    const year = Number(body.birthYear);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) {
      throw badRequest('birthYear must be a valid year');
    }
    result.birthYear = year;
  }
  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || body.phone.length > 30) throw badRequest('phone must be text up to 30 characters');
    result.phone = body.phone.trim();
  }
  return result;
}

module.exports = { evaluate, validateProfile, addDays, daysBetween, BLOOD_TYPES };
