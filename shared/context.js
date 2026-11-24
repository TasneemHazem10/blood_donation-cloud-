'use strict';

// Dependency injection for the data layer: the same controllers run on a PC
// (SQLite), on Floci (DynamoDB) and on Cloudflare Workers (Neon Postgres).
let activeStore = null;
let activeClock = () => new Date();

function setStore(store) {
  activeStore = store;
  return store;
}

function getStore() {
  if (!activeStore) throw new Error('Data layer has not been initialised');
  return activeStore;
}

function setClock(fn) { activeClock = fn; }
function now() { return activeClock().toISOString(); }

module.exports = { setStore, getStore, setClock, now };
