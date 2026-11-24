'use strict';

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
