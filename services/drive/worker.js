'use strict';

// Cloudflare Worker entry point for the Drive service.
// Shared modules are CommonJS; esbuild converts them into this bundle.
import configModule from '../../shared/config.js';
import contextModule from '../../shared/context.js';
import neonModule from '../../shared/store/neon.js';
import routerModule from '../../shared/router.js';
import serviceClientModule from '../../shared/serviceClient.js';
import routes from './routes.js';

const { setEnv } = configModule;
const { setStore } = contextModule;
const { createNeonStore } = neonModule;
const { workerFetch } = routerModule;
const { setServiceBindings } = serviceClientModule;

// The DDL is idempotent and only runs once per Worker isolate, not per request.
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
    setServiceBindings(env.BOOKING ? { booking: env.BOOKING } : null);
    return workerFetch(routes, request);
  }
};
