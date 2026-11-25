'use strict';

const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3001);

(async () => {
  const store = createStore();
  await store.init();
  setStore(store);
  createApp().listen(port, () => console.log(`Drive service ready on http://localhost:${port}`));
})().catch((error) => {
  console.error('DRIVE_STARTUP_FAILED', error);
  process.exit(1);
});
