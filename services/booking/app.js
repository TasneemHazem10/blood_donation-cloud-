'use strict';

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
    for (const [key, value] of Object.entries(corsHeaders(req.headers.origin))) res.set(key, value);
    next();
  });
  app.use(cors({ origin: config().corsOrigins.split(',').map((item) => item.trim()) }));
  app.use(normalizeServerlessBody);
  app.use(express.json({ limit: '20kb' }));
  app.get('/', (req, res) => res.json({ service: 'booking', ok: true }));
  return mountExpress(app, routes);
}

module.exports = { createApp };
