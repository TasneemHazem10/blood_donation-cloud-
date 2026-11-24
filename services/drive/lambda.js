'use strict';

// API Gateway (HTTP API v2) -> this handler -> the same Express app.
const serverless = require('serverless-http');
const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

let handler;
function ensure() {
  if (!handler) {
    setStore(createStore({ driver: 'dynamo' }));
    handler = serverless(createApp());
  }
  return handler;
}

exports.handler = async (event, context) => ensure()(event, context);
