'use strict';

// Local development and automated tests use a real SQL database with zero setup.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { TABLES, assertTable } = require('./tables');

function createSqliteStore(file = '.data/bdo.sqlite') {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);

  // Three local processes share this file. WAL + a busy timeout stop the
  // "database is locked" errors that occur while each service initialises.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  for (const table of TABLES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }

  const parse = (row) => (row ? JSON.parse(row.data) : null);

  return {
    driver: 'sqlite',
    async init() {},
    async get(table, id) {
      assertTable(table);
      return parse(db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(String(id)));
    },
    async put(table, record) {
      assertTable(table);
      db.prepare(`INSERT INTO ${table}(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
        .run(String(record.id), JSON.stringify(record));
      return record;
    },
    async insert(table, record) {
      assertTable(table);
      const result = db.prepare(`INSERT INTO ${table}(id, data) VALUES(?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(String(record.id), JSON.stringify(record));
      return result.changes === 1 ? record : null;
    },
    async update(table, id, patch) {
      const current = await this.get(table, id);
      if (!current) return null;
      const next = { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
      return this.put(table, next);
    },
    // Conditional update: only applies the patch when all expected fields match.
    async cas(table, id, patch, expected = {}) {
      assertTable(table);
      const current = await this.get(table, id);
      if (!current) return null;
      for (const [field, value] of Object.entries(expected)) {
        if (current[field] !== value) return null;
      }
      return this.update(table, id, patch);
    },
    async remove(table, id) {
      assertTable(table);
      const current = await this.get(table, id);
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(String(id));
      return result.changes === 1 ? current : null;
    },
    async all(table) {
      assertTable(table);
      return db.prepare(`SELECT data FROM ${table}`).all().map(parse);
    },
    async search(table, field, value) {
      assertTable(table);
      if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('Invalid search field');
      const rows = db.prepare(`SELECT data FROM ${table} WHERE json_extract(data, '$.${field}') = ?`).all(String(value));
      return rows.map(parse);
    },
    // Atomic seat change. The database rejects the write if it would overbook
    // or release a seat that was not taken.
    async reserveSeat(slotKey, delta) {
      const row = db.prepare(`
        UPDATE bdo_slots
        SET data = json_set(data, '$.booked', json_extract(data, '$.booked') + ?)
        WHERE id = ?
          AND json_extract(data, '$.booked') + ? BETWEEN 0 AND json_extract(data, '$.capacity')
        RETURNING data
      `).get(delta, String(slotKey), delta);
      return parse(row);
    },
    async close() { db.close(); }
  };
}

module.exports = { createSqliteStore };
