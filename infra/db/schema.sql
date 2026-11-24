-- Neon Postgres schema. Apply once in the Neon SQL editor or with psql.
-- Each row is one JSON document, so the three services share one simple,
-- auditable storage shape while keeping separate logical tables.
CREATE TABLE IF NOT EXISTS bdo_drives    (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_slots     (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_reports   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_users     (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_donors    (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_donations (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_bookings  (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_reminders (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bdo_geocodes  (id text PRIMARY KEY, data jsonb NOT NULL);
