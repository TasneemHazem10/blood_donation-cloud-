'use strict';

// Express application: same route table as the Cloudflare Worker.
const express = require('express');
const cors = require('cors');
const { config } = require('../../shared/config');
const { corsHeaders } = require('../../shared/http');
const { mountExpress, normalizeServerlessBody } = require('../../shared/router');
const routes = require('./routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
  app.use((req, res, next) => {
    const headers = corsHeaders(req.headers.origin);
    for (const [key, value] of Object.entries(headers)) res.set(key, value);
    next();
  });
  app.use(cors({ origin: config().corsOrigins.split(',').map((item) => item.trim()) }));
  app.use(normalizeServerlessBody);
  app.use(express.json({ limit: '20kb' }));
  app.get('/', (req, res) => res.json({ service: 'drive', ok: true }));
  return mountExpress(app, routes);
}

module.exports = { createApp };
