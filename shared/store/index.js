'use strict';

const { config } = require('../config');

// Node/Express/Floci entry points choose the data layer from DATA_DRIVER.
// Cloudflare Workers import shared/store/neon.js directly instead.
function createStore(options = {}) {
  const settings = config();
  const driver = options.driver || settings.dataDriver;
  if (driver === 'sqlite') {
    return require('./sqlite').createSqliteStore(options.file || settings.sqlitePath);
  }
  if (driver === 'dynamo') {
    return require('./dynamo').createDynamoStore(options);
  }
  if (driver === 'neon') {
    return require('./neon').createNeonStore(options.databaseUrl || settings.databaseUrl);
  }
  throw new Error(`Unknown DATA_DRIVER: ${driver} (use sqlite, dynamo or neon)`);
}

module.exports = { createStore };
