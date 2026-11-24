'use strict';

// Cloudflare Worker entry point for the Booking service.
import configModule from '../../shared/config.js';
import contextModule from '../../shared/context.js';
import neonModule from '../../shared/store/neon.js';
import routerModule from '../../shared/router.js';
import remindersModule from './controllers/reminders.js';
import rulesModule from './services/bookingRules.js';
import routes from './routes.js';

const { setEnv } = configModule;
const { setStore } = contextModule;
const { createNeonStore } = neonModule;
const { workerFetch } = routerModule;
const { sendForDate } = remindersModule;
const { tomorrow } = rulesModule;

export default {
  async fetch(request, env) {
    setEnv(env);
    setStore(createNeonStore(env.DATABASE_URL));
    return workerFetch(routes, request);
  },
  // Cloudflare Cron Trigger: 06:00 UTC daily. The same function backs the
  // organizer button and the /internal/reminders/daily endpoint.
  async scheduled(controller, env, ctx) {
    setEnv(env);
    setStore(createNeonStore(env.DATABASE_URL));
    const date = tomorrow();
    ctx.waitUntil(sendForDate(date).catch((error) => console.error('DAILY_REMINDER_FAILED', error)));
  }
};
