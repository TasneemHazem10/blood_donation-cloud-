'use strict';

const { config } = require('../../../shared/config');
const { getStore, now } = require('../../../shared/context');
const { hashPassword, verifyPassword, createToken, newId } = require('../../../shared/crypto');
const { badRequest, conflict, unauthorized, notFound } = require('../../../shared/errors');
const { ok, created } = require('../../../shared/http');
const { emailField, stringField } = require('../../../shared/validate');
const { verifyTurnstile } = require('../../../shared/external/turnstile');
const { validateProfile } = require('../services/eligibility');
const { check } = require('../services/authRateLimit');

const store = () => getStore();
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt });

async function register(ctx) {
  const body = ctx.body || {};
  check(`register:${ctx.ip || 'local'}`);
  await verifyTurnstile(body.turnstileToken, ctx.ip);

  const email = emailField(body);
  const password = stringField(body, 'password', { min: 8, max: 128 });
  const name = stringField(body, 'name', { min: 2, max: 80 });
  const role = body.role === 'organizer' ? 'organizer' : 'donor';
  if (role === 'organizer' && body.inviteCode !== config().organizerInvite) {
    throw conflict('Organizer invite code is not correct');
  }
  const profile = role === 'donor' ? validateProfile(body) : {};

  if (await store().get('bdo_users', email)) throw conflict('An account with that email already exists');
  const user = {
    id: email,
    email,
    name,
    role,
    passwordHash: await hashPassword(password),
    createdAt: now()
  };
  const saved = await store().insert('bdo_users', user);
  if (!saved) throw conflict('An account with that email already exists');

  await store().put('bdo_donors', {
    id: email,
    userId: email,
    name,
    email,
    ...profile,
    lastDonationDate: null,
    deferredUntil: null,
    createdAt: now()
  });

  const token = await createToken({ id: user.id, email, name, role }, config().jwtSecret);
  return created({ token, user: publicUser(user) });
}

async function login(ctx) {
  const body = ctx.body || {};
  check(`login:${String(body.email || ctx.ip || 'local').toLowerCase()}`);
  await verifyTurnstile(body.turnstileToken, ctx.ip);

  const email = emailField(body);
  const password = stringField(body, 'password', { min: 1, max: 128 });
  const user = await store().get('bdo_users', email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw unauthorized('Email or password is incorrect');
  }
  const token = await createToken({ id: user.id, email, name: user.name, role: user.role }, config().jwtSecret);
  return ok({ token, user: publicUser(user) });
}

async function me(ctx) {
  const user = await store().get('bdo_users', ctx.user.id);
  if (!user) throw notFound('Account not found');
  return ok({ user: publicUser(user) });
}

module.exports = { register, login, me, publicUser };
