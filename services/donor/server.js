'use strict';

const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3002);

(async () => {
  const store = createStore();
  await store.init();
  setStore(store);
  createApp().listen(port, () => console.log(`Donor service ready on http://localhost:${port}`));
})().catch((error) => {
  console.error('DONOR_STARTUP_FAILED', error);
  process.exit(1);
});
