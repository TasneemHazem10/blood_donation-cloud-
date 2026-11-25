'use strict';

const { getStore, now } = require('../../../shared/context');
const { newId } = require('../../../shared/crypto');
const { conflict, forbidden, notFound } = require('../../../shared/errors');
const { ok, noContent } = require('../../../shared/http');
const { callService } = require('../../../shared/serviceClient');
const { evaluate, validateProfile } = require('../services/eligibility');

const store = () => getStore();

function requireDonor(ctx) {
  if (ctx.user.role !== 'donor') throw forbidden('Only a donor account can use this endpoint');
  return ctx.user.id;
}

async function getProfile(ctx) {
  const id = requireDonor(ctx);
  const donor = await store().get('bdo_donors', id);
  if (!donor) throw notFound('Donor profile not found');
  const result = { ...donor, eligibility: evaluate(donor, new Date().toISOString().slice(0, 10)) };
  return ok({ donor: result });
}

async function updateProfile(ctx) {
  const id = requireDonor(ctx);
  const donor = await store().get('bdo_donors', id);
  if (!donor) throw notFound('Donor profile not found');
  const patch = validateProfile(ctx.body || {}, true);
  if (!Object.keys(patch).length) throw conflict('No profile fields were supplied');
  return ok({ donor: await store().update('bdo_donors', id, patch) });
}

async function getEligibility(ctx) {
  const id = requireDonor(ctx);
  const donor = await store().get('bdo_donors', id);
  const date = ctx.query.date || new Date().toISOString().slice(0, 10);
  return ok(evaluate(donor, date));
}

async function getDonations(ctx) {
  const id = requireDonor(ctx);
  const donations = (await store().search('bdo_donations', 'donorId', id))
    .sort((a, b) => b.date.localeCompare(a.date));
  return ok({ count: donations.length, donations });
}

async function deleteAccount(ctx) {
  const id = requireDonor(ctx);
  const active = await callService('booking', 'GET', `/internal/donors/${id}/active-bookings`);
  if (active.count > 0) {
    throw conflict(`Cancel your ${active.count} upcoming booking(s) before deleting your account`);
  }
  // Keep booking/report history but remove the donor's name and email from it.
  await callService('booking', 'POST', `/internal/donors/${id}/anonymize`, { body: {} });
  for (const donation of await store().search('bdo_donations', 'donorId', id)) {
    await store().remove('bdo_donations', donation.id);
  }
  await store().remove('bdo_donors', id);
  await store().remove('bdo_users', id);
  return noContent();
}

async function health() { return ok({ status: 'ok', service: 'donor', time: now() }); }

module.exports = { getProfile, updateProfile, getEligibility, getDonations, deleteAccount, health, requireDonor };
