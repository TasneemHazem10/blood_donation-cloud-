'use strict';

// Neon Postgres data layer. One HTTP query per operation, so it also runs
// inside a Cloudflare Worker without a TCP connection pool.
const { neon } = require('@neondatabase/serverless');
const { TABLES, assertTable } = require('./tables');

function createNeonStore(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Neon data layer');
  const sql = neon(databaseUrl);
  const parse = (row) => (row && row.data ? row.data : null);

  return {
    driver: 'neon',
    async init() {
      for (const table of TABLES) {
        await sql.query(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, data jsonb NOT NULL)`);
      }
    },
    async get(table, id) {
      assertTable(table);
      const rows = await sql.query(`SELECT data FROM ${table} WHERE id = $1`, [String(id)]);
      return parse(rows[0]);
    },
    async put(table, record) {
      assertTable(table);
      await sql.query(
        `INSERT INTO ${table}(id, data) VALUES($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
        [String(record.id), JSON.stringify(record)]
      );
      return record;
    },
    async insert(table, record) {
      assertTable(table);
      const rows = await sql.query(
        `INSERT INTO ${table}(id, data) VALUES($1, $2::jsonb) ON CONFLICT (id) DO NOTHING RETURNING data`,
        [String(record.id), JSON.stringify(record)]
      );
      return rows.length ? parse(rows[0]) : null;
    },
    async update(table, id, patch) {
      assertTable(table);
      const rows = await sql.query(
        `UPDATE ${table} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`,
        [String(id), JSON.stringify({ ...patch, updatedAt: patch.updatedAt || new Date().toISOString() })]
      );
      return parse(rows[0]);
    },
    async cas(table, id, patch, expected = {}) {
      assertTable(table);
      const fields = Object.entries(expected);
      const conditions = ['id = $1'];
      const values = [String(id)];
      for (let i = 0; i < fields.length; i += 1) {
        values.push(String(fields[i][1]));
        conditions.push(`data->>'${fields[i][0]}' = $${i + 2}`);
      }
      values.push(JSON.stringify({ ...patch, updatedAt: new Date().toISOString() }));
      const rows = await sql.query(
        `UPDATE ${table} SET data = data || $${values.length}::jsonb WHERE ${conditions.join(' AND ')} RETURNING data`,
        values
      );
      return parse(rows[0]);
    },
    async remove(table, id) {
      assertTable(table);
      const rows = await sql.query(`DELETE FROM ${table} WHERE id = $1 RETURNING data`, [String(id)]);
      return parse(rows[0]);
    },
    async all(table) {
      assertTable(table);
      const rows = await sql.query(`SELECT data FROM ${table}`);
      return rows.map(parse);
    },
    async search(table, field, value) {
      assertTable(table);
      if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('Invalid search field');
      const rows = await sql.query(`SELECT data FROM ${table} WHERE data->>'${field}' = $1`, [String(value)]);
      return rows.map(parse);
    },
    async reserveSeat(slotKey, delta) {
      const rows = await sql.query(`
        UPDATE bdo_slots
        SET data = jsonb_set(data, '{booked}', to_jsonb((data->>'booked')::integer + $1))
        WHERE id = $2
          AND (data->>'booked')::integer + $1 BETWEEN 0 AND (data->>'capacity')::integer
        RETURNING data
      `, [delta, String(slotKey)]);
      return parse(rows[0]);
    },
    async close() {}
  };
}

module.exports = { createNeonStore };
