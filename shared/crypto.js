'use strict';

// WebCrypto works in Node 22+ and in Cloudflare Workers, so the same code runs in both.
const { unauthorized } = require('./errors');

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 60000;

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Invalid base64url value');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Invalid base64url value');
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function subtle() {
  if (globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
  throw new Error('WebCrypto is not available in this runtime');
}

async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${ITERATIONS}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`;
}

function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, iterations, saltText, hashText] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltText || !hashText) return false;
  const key = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({
    name: 'PBKDF2', salt: fromBase64url(saltText), iterations: Number(iterations), hash: 'SHA-256'
  }, key, 256);
  return constantEqual(new Uint8Array(bits), fromBase64url(hashText));
}

async function createToken(payload, secret, maxAgeSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + maxAgeSeconds };
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(body)))}`;
  const key = await subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await subtle().sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw unauthorized('A valid login token is required');
  }
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  try {
    // Never let malformed base64/JSON escape as a 500: every invalid token is
    // an authentication failure, including an unexpected JWT header.
    const header = JSON.parse(decoder.decode(fromBase64url(headerPart)));
    if (!header || header.alg !== 'HS256') throw unauthorized('Login token is not valid');
    const key = await subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await subtle().verify(
      'HMAC', key, fromBase64url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`)
    );
    if (!valid) throw unauthorized('Login token is not valid');
    const payload = JSON.parse(decoder.decode(fromBase64url(payloadPart)));
    if (!payload || typeof payload !== 'object') throw unauthorized('Login token is not valid');
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw unauthorized('Login token has expired');
    return payload;
  } catch (error) {
    if (error && error.code === 'UNAUTHORIZED') throw error;
    throw unauthorized('Login token is not valid');
  }
}

function newId(prefix = '') {
  const id = globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prefix ? `${prefix}_${id}` : id;
}

module.exports = { hashPassword, verifyPassword, createToken, verifyToken, newId, constantEqual };
