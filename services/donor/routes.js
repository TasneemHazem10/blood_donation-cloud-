'use strict';

const { route } = require('../../shared/router');
const auth = require('./controllers/auth');
const donors = require('./controllers/donors');
const internal = require('./controllers/internal');

module.exports = [
  route('GET', '/api/health/donor', donors.health),
  route('POST', '/api/auth/register', auth.register),
  route('POST', '/api/auth/login', auth.login),
  route('GET', '/api/auth/me', auth.me, { auth: true }),
  route('GET', '/api/donors/me', donors.getProfile, { auth: true }),
  route('PUT', '/api/donors/me', donors.updateProfile, { auth: true }),
  route('GET', '/api/donors/me/eligibility', donors.getEligibility, { auth: true }),
  route('GET', '/api/donors/me/donations', donors.getDonations, { auth: true }),
  route('DELETE', '/api/donors/me', donors.deleteAccount, { auth: true }),

  route('GET', '/internal/donors/:id/eligibility', internal.eligibility, { internal: true }),
  route('POST', '/internal/donations', internal.recordDonation, { internal: true }),
  route('GET', '/internal/donors/:id', internal.getDonor, { internal: true })
];
