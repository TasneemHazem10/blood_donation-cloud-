'use strict';

const { getStore, now } = require('../../../shared/context');
const { newId } = require('../../../shared/crypto');
const { badRequest, conflict, notFound } = require('../../../shared/errors');
const { ok, created } = require('../../../shared/http');
const { idParam, dateField } = require('../../../shared/validate');
const { evaluate } = require('../services/eligibility');

const store = () => getStore();

async function eligibility(ctx) {
  const id = idParam(ctx.params);
  const date = dateField({ date: ctx.query.date || new Date().toISOString().slice(0, 10) }, 'date');
  const donor = await store().get('bdo_donors', id);
  return ok({
    ...evaluate(donor, date),
    donor: donor ? { id: donor.id, name: donor.name, email: donor.email, bloodType: donor.bloodType || null } : null
  });
}

async function recordDonation(ctx) {
  const body = ctx.body || {};
  const donorId = idParam(body, 'donorId');
  const driveId = idParam(body, 'driveId');
  const date = dateField(body, 'date');
  const id = body.donationId ? idParam(body, 'donationId') : newId('don');
  const existing = await store().get('bdo_donations', id);
  if (existing) return ok({ donation: existing, duplicate: true });

  const donor = await store().get('bdo_donors', donorId);
  if (!donor) throw notFound('Donor not found');
  // Check-in records the donation on the drive date, so the 56-day interval
  // must be enforced here too, not only when the donor first books.
  const evaluation = evaluate(donor, date);
  if (!evaluation.eligible) throw conflict(evaluation.reason || 'Donor is not eligible to donate on that date');

  const donation = { id, donorId, driveId, date, recordedAt: now() };
  const saved = await store().insert('bdo_donations', donation);
  if (!saved) {
    const raced = await store().get('bdo_donations', id);
    return ok({ donation: raced || donation, duplicate: true });
  }
  if (!donor.lastDonationDate || donor.lastDonationDate < date) {
    await store().update('bdo_donors', donorId, { lastDonationDate: date });
  }
  return created({ donation: saved, duplicate: false });
}

async function getDonor(ctx) {
  const id = idParam(ctx.params);
  const donor = await store().get('bdo_donors', id);
  if (!donor) throw notFound('Donor not found');
  return ok({ donor });
}

module.exports = { eligibility, recordDonation, getDonor };
