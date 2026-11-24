'use strict';

const { HttpError } = require('../../../shared/errors');

const attempts = new Map();
const LIMIT = 8;
const WINDOW_MS = 10 * 60 * 1000;

// Simple per-process limiter for login/register. Deployed services also have
// Cloudflare WAF rate limiting in front of them.
function check(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) {
    throw new HttpError(429, 'Too many attempts. Please wait 10 minutes and try again.', 'RATE_LIMIT');
  }
  recent.push(now);
  attempts.set(key, recent);
}

module.exports = { check };
