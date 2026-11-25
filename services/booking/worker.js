'use strict';

// Cloudflare Worker entry point for the Booking service.
import configModule from '../../shared/config.js';
import contextModule from '../../shared/context.js';
import neonModule from '../../shared/store/neon.js';
import routerModule from '../../shared/router.js';
import serviceClientModule from '../../shared/serviceClient.js';
import remindersModule from './controllers/reminders.js';
import rulesModule from './services/bookingRules.js';
import routes from './routes.js';

const { setEnv } = configModule;
const { setStore } = contextModule;
const { createNeonStore } = neonModule;
const { workerFetch } = routerModule;
const { setServiceBindings } = serviceClientModule;
const { sendForDate } = remindersModule;
const { tomorrow } = rulesModule;

let storePromise = null;
async function initialise(env) {
  if (!storePromise) {
    const store = createNeonStore(env.DATABASE_URL);
    storePromise = store.init().then(() => store).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

export default {
  async fetch(request, env) {
    setEnv(env);
    setStore(await initialise(env));
    setServiceBindings({
      ...(env.DRIVE ? { drive: env.DRIVE } : {}),
      ...(env.DONOR ? { donor: env.DONOR } : {})
    });
    return workerFetch(routes, request);
  },
  // Cloudflare Cron Trigger: 06:00 UTC daily. The same function backs the
  // organizer button and the /internal/reminders/daily endpoint.
  async scheduled(controller, env, ctx) {
    setEnv(env);
    setStore(await initialise(env));
    const date = tomorrow();
    ctx.waitUntil(sendForDate(date).catch((error) => console.error('DAILY_REMINDER_FAILED', error)));
  }
};
