'use strict';

// API Gateway (HTTP API v2) -> this handler -> the same Express app.
const serverless = require('serverless-http');
const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

let ready = null;
async function ensure() {
  if (!ready) {
    ready = (async () => {
      const store = createStore({ driver: 'dynamo' });
      await store.init();
      setStore(store);
      return serverless(createApp());
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

exports.handler = async (event, context) => (await ensure())(event, context);
