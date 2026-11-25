'use strict';

// Server-to-server HTTP calls. On a PC and on Floci these target the other
// Express services; on Cloudflare Workers they target the other Workers.
const { config } = require('./config');
const { HttpError, unavailable } = require('./errors');

let fetchImpl = (...args) => globalThis.fetch(...args);
let serviceBindings = null;
function setServiceFetch(impl) { fetchImpl = impl || ((...args) => globalThis.fetch(...args)); }

// Cloudflare Workers can call each other through service bindings instead of
// public workers.dev URLs. A binding exposes `fetch(request, init)`.
function setServiceBindings(bindings) { serviceBindings = bindings || null; }

const BASES = {
  drive: (settings) => settings.driveUrl,
  donor: (settings) => settings.donorUrl,
  booking: (settings) => settings.bookingUrl
};

async function callService(service, method, path, options = {}) {
  const settings = config();
  const resolveBase = BASES[service];
  if (!resolveBase) throw unavailable(`Service ${service} is not configured`);
  // Resolve the Worker binding first: service bindings make the URL host
  // cosmetic, so a missing workers.dev URL must not break a bound call.
  const binding = serviceBindings && serviceBindings[service];
  const base = binding ? `https://${service}.internal` : resolveBase(settings);
  if (!base) throw unavailable(`${service} service URL is not configured`);
  let url;
  try {
    url = new URL(`${String(base).replace(/\/$/, '')}${path}`);
  } catch {
    throw unavailable(`${service} service URL is invalid`);
  }
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const headers = { 'content-type': 'application/json' };
  if (options.internal !== false) headers['x-internal-key'] = settings.internalKey;
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const init = {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10000)
  };
  let response;
  try {
    response = binding
      ? await binding.fetch(url.toString(), init)
      : await fetchImpl(url.toString(), init);
  } catch (error) {
    throw new HttpError(502, `${service} service is unreachable: ${error.message}`, 'SERVICE_UNAVAILABLE');
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: { message: text } }; }
  }
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `${service} service returned ${response.status}`;
    throw new HttpError(response.status, message, payload && payload.error && payload.error.code);
  }
  return payload;
}

module.exports = { callService, setServiceFetch, setServiceBindings };
