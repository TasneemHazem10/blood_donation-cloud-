'use strict';

const { config } = require('./config');

const ok = (body) => ({ status: 200, body });
const created = (body) => ({ status: 201, body });
const noContent = () => ({ status: 204, body: null });

function corsHeaders(requestOrigin) {
  const allowed = config().corsOrigins.split(',').map((item) => item.trim()).filter(Boolean);
  const origin = requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-internal-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  };
}

function jsonResponse(status, body, headers = {}) {
  // Only an explicit 204 is bodyless. A 200 with a null body stays a 200 so
  // callers can distinguish "success" from "no content".
  if (status === 204 || body === null || body === undefined) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

module.exports = { ok, created, noContent, corsHeaders, jsonResponse };
