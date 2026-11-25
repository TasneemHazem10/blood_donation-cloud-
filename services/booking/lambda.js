'use strict';

// API Gateway (HTTP API v2) -> this handler -> the same Express app.
// EventBridge also invokes this function directly for the daily reminder job.
const serverless = require('serverless-http');
const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

let storeReady = null;
let handlerReady = null;

async function ensureStore() {
  if (!storeReady) {
    storeReady = (async () => {
      const store = createStore({ driver: 'dynamo' });
      await store.init();
      setStore(store);
      return store;
    })().catch((error) => {
      storeReady = null;
      throw error;
    });
  }
  return storeReady;
}

function scheduledEvent(event) {
  return Boolean(event && event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event');
}

exports.handler = async (event, context) => {
  await ensureStore();
  if (scheduledEvent(event)) {
    const { sendForDate } = require('./controllers/reminders');
    const { tomorrow } = require('./services/bookingRules');
    const date = (event.detail && event.detail.date) || tomorrow();
    return sendForDate(date);
  }
  if (!handlerReady) handlerReady = Promise.resolve(serverless(createApp()));
  return (await handlerReady)(event, context);
};
