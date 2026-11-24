'use strict';

// Real external integration: Cloudflare Turnstile protects register/login.
// A secret is only required in deployed environments; TEST_MODE skips it.
const { config } = require('../config');
const { unauthorized, unavailable } = require('../errors');

async function verifyTurnstile(token, ip = '') {
  if (config().testMode) return { ok: true, mode: 'test' };
  const secret = config().turnstileSecret;
  if (!secret) return { ok: true, mode: 'development' };
  if (!token) throw unauthorized('Bot check is required. Please complete the verification.');

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(7000)
    });
    const result = await response.json();
    if (!result.success) throw unauthorized('Bot check failed. Please try again.');
    return { ok: true, mode: 'turnstile' };
  } catch (error) {
    if (error.status === 401) throw error;
    console.warn('TURNSTILE_FAILED', error.message);
    throw unavailable('Bot check service is unavailable');
  }
}

module.exports = { verifyTurnstile };
