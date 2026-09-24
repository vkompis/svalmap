-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Core tables
CREATE TABLE IF NOT EXISTS gfw_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'ais_off' | 'encounter' | 'loitering' | ...
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ts TIMESTAMPTZ, -- representative timestamp if single instant
  geom GEOGRAPHY(POINT,4326), -- representative point (centroid/midpoint)
  vessels JSONB, -- array of involved vessels with ids/mmsi/imo
  payload_json JSONB, -- full raw payload for audit
  source_version TEXT, -- GFW API version / release tag if available
  inserted_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Turn into hypertable on ts for fast time-window queries
SELECT create_hypertable('gfw_events', 'ts', if_not_exists => TRUE);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS gfw_events_ts_idx ON gfw_events (ts DESC);
CREATE INDEX IF NOT EXISTS gfw_events_type_ts_idx ON gfw_events (type, ts DESC);
CREATE INDEX IF NOT EXISTS gfw_events_geom_idx ON gfw_events USING GIST (geom);

-- Optional materialized view for encounters endpoints (paired geometry)
-- You can also store encounter links as LineStrings in a separate table if the API returns both endpoints.
CREATE TABLE IF NOT EXISTS gfw_encounter_links (
  id TEXT PRIMARY KEY, -- same id as event or composite
  ts TIMESTAMPTZ,
  geom GEOGRAPHY(LINESTRING,4326),
  payload_json JSONB
);

CREATE INDEX IF NOT EXISTS gfw_encounters_ts_idx ON gfw_encounter_links (ts DESC);
CREATE INDEX IF NOT EXISTS gfw_encounters_geom_idx ON gfw_encounter_links USING GIST (geom);

-- Incidents table (you already have this; included here for clarity)
CREATE TABLE IF NOT EXISTS incidents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL, -- 'ais_off', 'encounter', etc.
  ts TIMESTAMPTZ NOT NULL,
  geom GEOGRAPHY,
  severity SMALLINT,
  source TEXT, -- 'gfw'
  payload_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_ts_idx ON incidents (ts DESC);
CREATE INDEX IF NOT EXISTS incidents_geom_idx ON incidents USING GIST (geom);



