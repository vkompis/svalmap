-- SvalMap Database Schema
-- BigQuery GIS tables for maritime monitoring system

-- Vessels table - stores vessel metadata
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.vessels` (
  mmsi STRING NOT NULL,
  name STRING,
  call_sign STRING,
  imo STRING,
  vessel_type STRING NOT NULL,
  length FLOAT64,
  width FLOAT64,
  flag STRING,
  is_military BOOLEAN NOT NULL,
  is_research BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  metadata JSON
);

-- Vessel positions table - stores real-time AIS data
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.vessel_positions` (
  id STRING NOT NULL,
  mmsi STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  coordinates GEOGRAPHY NOT NULL,
  speed FLOAT64, -- knots
  course FLOAT64, -- degrees
  heading FLOAT64, -- degrees
  status STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  partition_date DATE NOT NULL
)
PARTITION BY partition_date
CLUSTER BY mmsi, status;

-- Incidents table - stores detected security incidents
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.incidents` (
  id STRING NOT NULL,
  type STRING NOT NULL,
  severity STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  coordinates GEOGRAPHY NOT NULL,
  description STRING NOT NULL,
  status STRING NOT NULL,
  vessels ARRAY<STRING>, -- MMSI numbers (nullable in BigQuery)
  metadata JSON,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  partition_date DATE NOT NULL
)
PARTITION BY partition_date
CLUSTER BY type, severity, status;

-- Restricted areas table - stores military and environmental zones
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.restricted_areas` (
  id STRING NOT NULL,
  name STRING NOT NULL,
  type STRING NOT NULL,
  coordinates GEOGRAPHY NOT NULL,
  description STRING,
  restrictions ARRAY<STRING>, -- nullable in BigQuery
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Cable routes table - stores submarine cable infrastructure
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.cable_routes` (
  id STRING NOT NULL,
  name STRING NOT NULL,
  coordinates GEOGRAPHY NOT NULL,
  description STRING,
  criticality STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Sanctions table - stores vessel blacklist
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.sanctions` (
  id STRING NOT NULL,
  mmsi STRING,
  name STRING,
  reason STRING NOT NULL,
  source STRING NOT NULL,
  effective_date DATE NOT NULL,
  expiry_date DATE,
  is_active BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Analytics table - stores aggregated metrics
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.analytics` (
  id STRING NOT NULL,
  metric_name STRING NOT NULL,
  metric_value FLOAT64 NOT NULL,
  coordinates GEOGRAPHY,
  bounding_box GEOGRAPHY,
  time_period STRING NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL
);

-- Alerts table - stores real-time alerts
CREATE TABLE IF NOT EXISTS `svalmap.marine_osint.alerts` (
  id STRING NOT NULL,
  type STRING NOT NULL,
  severity STRING NOT NULL,
  message STRING NOT NULL,
  coordinates GEOGRAPHY,
  vessel_mmsi STRING,
  incident_id STRING,
  is_acknowledged BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Create views for common queries
CREATE OR REPLACE VIEW `svalmap.marine_osint.vessel_positions_recent` AS
SELECT 
  vp.*,
  v.name as vessel_name,
  v.vessel_type,
  v.flag
FROM `svalmap.marine_osint.vessel_positions` vp
JOIN `svalmap.marine_osint.vessels` v ON vp.mmsi = v.mmsi
WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR);

CREATE OR REPLACE VIEW `svalmap.marine_osint.active_incidents` AS
SELECT 
  i.*,
  v.name as vessel_name,
  v.vessel_type
FROM `svalmap.marine_osint.incidents` i
JOIN `svalmap.marine_osint.vessels` v ON mmsi = v.mmsi
WHERE i.status = 'active'
AND i.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY);
