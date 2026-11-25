'use strict';

// A small router shared by Express (PC + Floci Lambda) and Cloudflare Workers.
// Controllers never see req/res: they receive ctx and return { status, body }.
const { config } = require('./config');
const { verifyToken } = require('./crypto');
const { unauthorized, forbidden, notFound, badRequest, payloadTooLarge, toErrorBody } = require('./errors');
const { corsHeaders, jsonResponse } = require('./http');

function route(method, path, handler, options = {}) {
  const keys = [];
  const pattern = path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return {
    method: method.toUpperCase(),
    path,
    handler,
    auth: Boolean(options.auth),
    roles: options.roles || null,
    internal: Boolean(options.internal),
    keys,
    regex: new RegExp(`^${pattern}/?$`)
  };
}

function header(ctx, name) {
  const source = ctx.headers || {};
  if (typeof source.get === 'function') return source.get(name);
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(source)) {
    if (key.toLowerCase() === lower) return source[key];
  }
  return null;
}

async function applyAuth(ctx, definition) {
  if (definition.internal) {
    if (header(ctx, 'x-internal-key') !== config().internalKey) {
      throw unauthorized('Internal service key is missing or wrong');
    }
    return;
  }
  if (!definition.auth && !definition.roles) return;
  const value = header(ctx, 'authorization') || '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : null;
  if (!token) throw unauthorized('Login token is required');
  ctx.user = await verifyToken(token, config().jwtSecret);
  if (definition.roles && !definition.roles.includes(ctx.user.role)) {
    throw forbidden('Your account role cannot use this endpoint');
  }
}

function matchRoute(routes, method, pathname) {
  for (const definition of routes) {
    if (definition.method !== method) continue;
    const found = definition.regex.exec(pathname);
    if (!found) continue;
    const params = {};
    definition.keys.forEach((key, index) => {
      try {
        params[key] = decodeURIComponent(found[index + 1]);
      } catch {
        throw badRequest('Malformed URL path');
      }
    });
    return { definition, params };
  }
  return null;
}

async function workerFetch(routes, request) {
  const url = new URL(request.url);
  const headers = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  let matched;
  try {
    matched = matchRoute(routes, request.method, url.pathname);
  } catch (error) {
    const translated = toErrorBody(error);
    return jsonResponse(translated.status, translated.body, headers);
  }
  if (!matched) {
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, headers);
  }

  try {
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const text = await request.text();
      if (text) {
        if (text.length > 20000) throw payloadTooLarge('Request body too large');
        try { body = JSON.parse(text); } catch { throw badRequest('Body must be valid JSON'); }
      }
    }
    const ctx = {
      params: matched.params,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      headers: request.headers,
      request,
      ip: request.headers.get('cf-connecting-ip') || ''
    };
    await applyAuth(ctx, matched.definition);
    const result = await matched.definition.handler(ctx) || {};
    return jsonResponse(result.status || 200, result.body === undefined ? null : result.body, {
      ...headers, ...(result.headers || {})
    });
  } catch (error) {
    const translated = toErrorBody(error);
    return jsonResponse(translated.status, translated.body, headers);
  }
}

function mountExpress(app, routes) {
  for (const definition of routes) {
    app[definition.method.toLowerCase()](definition.path, async (req, res, next) => {
      try {
        const ctx = {
          params: req.params,
          query: req.query,
          body: req.body || {},
          headers: req.headers,
          req,
          ip: req.ip || ''
        };
        await applyAuth(ctx, definition);
        const result = await definition.handler(ctx) || {};
        if (result.status === 204) return res.status(204).end();
        return res.status(result.status || 200).json(result.body === undefined ? null : result.body);
      } catch (error) {
        return next(error);
      }
    });
  }
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use((error, req, res, next) => {
    const translated = toErrorBody(error);
    res.status(translated.status).json(translated.body);
  });
  return app;
}

// serverless-http marks the request complete and hands the body to Express as
// a Buffer. Express 5's body-parser skips completed requests, so parse it here.
function normalizeServerlessBody(req, res, next) {
  if (!Buffer.isBuffer(req.body)) return next();
  const text = req.body.toString('utf8');
  if (!text) { req.body = {}; return next(); }
  if (text.length > 20000) {
    const translated = toErrorBody(payloadTooLarge('Request body too large'));
    return res.status(translated.status).json(translated.body);
  }
  try {
    req.body = JSON.parse(text);
    return next();
  } catch {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } });
  }
}

module.exports = { route, applyAuth, matchRoute, workerFetch, mountExpress, header, normalizeServerlessBody };
