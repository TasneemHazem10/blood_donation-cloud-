'use strict';

// Cloudflare Worker entry point for the Donor service.
import configModule from '../../shared/config.js';
import contextModule from '../../shared/context.js';
import neonModule from '../../shared/store/neon.js';
import routerModule from '../../shared/router.js';
import routes from './routes.js';

const { setEnv } = configModule;
const { setStore } = contextModule;
const { createNeonStore } = neonModule;
const { workerFetch } = routerModule;

export default {
  async fetch(request, env) {
    setEnv(env);
    setStore(createNeonStore(env.DATABASE_URL));
    return workerFetch(routes, request);
  }
};
