'use strict';

// One logical table per entity. The same names are used by SQLite (local),
// DynamoDB (Floci/AWS) and Neon Postgres (Cloudflare/public deployment).
const TABLES = Object.freeze([
  'bdo_drives',
  'bdo_slots',
  'bdo_reports',
  'bdo_users',
  'bdo_donors',
  'bdo_donations',
  'bdo_bookings',
  'bdo_reminders',
  'bdo_geocodes'
]);

function assertTable(table) {
  if (!TABLES.includes(table)) throw new Error(`Unknown table: ${table}`);
  return table;
}

module.exports = { TABLES, assertTable };
