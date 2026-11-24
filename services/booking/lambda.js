'use strict';

// API Gateway (HTTP API v2) -> this handler -> the same Express app.
// EventBridge also invokes this function directly for the daily reminder job.
const serverless = require('serverless-http');
const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

let handler;
let storeReady = false;
function ensureStore() {
  // getStore() throws when the store is unset, so track readiness explicitly.
  if (!storeReady) {
    setStore(createStore({ driver: 'dynamo' }));
    storeReady = true;
  }
}

function scheduledEvent(event) {
  return Boolean(event && event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event');
}

exports.handler = async (event, context) => {
  ensureStore();
  if (scheduledEvent(event)) {
    const { sendForDate } = require('./controllers/reminders');
    const { tomorrow } = require('./services/bookingRules');
    const date = (event.detail && event.detail.date) || tomorrow();
    return sendForDate(date);
  }
  if (!handler) handler = serverless(createApp());
  return handler(event, context);
};
