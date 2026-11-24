'use strict';

// All settings come from environment variables. Nothing secret is stored in code.
let runtimeEnv = null;

// Cloudflare Workers provide secrets in the fetch `env` binding instead of
// process.env. Worker entry points call setEnv(env) once per request.
function setEnv(values) { runtimeEnv = values || null; }

function env(name, fallback = '') {
  let value;
  if (runtimeEnv && runtimeEnv[name] !== undefined) value = runtimeEnv[name];
  else if (typeof process !== 'undefined' && process.env) value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function config() {
  return {
    nodeEnv: env('NODE_ENV', 'development'),
    testMode: env('TEST_MODE') === '1',
    dataDriver: env('DATA_DRIVER', 'sqlite'),
    sqlitePath: env('SQLITE_PATH', '.data/bdo.sqlite'),
    databaseUrl: env('DATABASE_URL'),
    awsRegion: env('AWS_REGION', 'us-east-1'),
    awsEndpoint: env('AWS_ENDPOINT_URL', env('AWS_ENDPOINT', '')),
    jwtSecret: env('JWT_SECRET', 'dev-only-change-me'),
    internalKey: env('INTERNAL_KEY', 'dev-only-internal-key'),
    organizerInvite: env('ORGANIZER_INVITE', 'blood2026'),
    corsOrigins: env('CORS_ORIGINS', 'http://localhost:8090'),
    driveUrl: env('DRIVE_SERVICE_URL', 'http://localhost:3001'),
    donorUrl: env('DONOR_SERVICE_URL', 'http://localhost:3002'),
    bookingUrl: env('BOOKING_SERVICE_URL', 'http://localhost:3003'),
    turnstileSecret: env('TURNSTILE_SECRET'),
    turnstileSiteKey: env('TURNSTILE_SITE_KEY'),
    brevoKey: env('BREVO_API_KEY'),
    emailFrom: env('EMAIL_FROM', 'Blood Drive <donations@example.org>'),
    emailMode: env('EMAIL_MODE', 'log'),
    reportsBucket: env('REPORTS_BUCKET', ''),
    donationIntervalDays: Number(env('DONATION_INTERVAL_DAYS', '56')),
    reminderDaysAhead: Number(env('REMINDER_DAYS_AHEAD', '1'))
  };
}

module.exports = { config, env, setEnv };
