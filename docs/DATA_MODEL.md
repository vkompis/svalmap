# SvalMap Data Model

## Overview
SvalMap uses a hybrid data storage approach combining BigQuery GIS for historical data and spatial queries, and Firestore for real-time updates and UI summaries.

## Database Architecture

### BigQuery GIS (Primary Storage)
- **Purpose**: Long-term storage, spatial analytics, and complex queries
- **Tables**: Partitioned by date for efficient querying
- **Features**: Native GIS functions, clustering for performance

### Firestore (Real-time Storage)
- **Purpose**: Real-time updates, UI state, and user preferences
- **Collections**: Organized by data type with subcollections
- **Features**: Real-time listeners, offline support, document-based

## Core Data Entities

### Vessels
**Table**: `vessels`
**Purpose**: Master vessel registry with metadata

```sql
CREATE TABLE vessels (
  mmsi STRING NOT NULL,           -- Unique vessel identifier
  name STRING,                     -- Vessel name
  call_sign STRING,                -- Radio call sign
  imo STRING,                      -- IMO number
  vessel_type STRING NOT NULL,     -- Type classification
  length FLOAT64,                  -- Length in meters
  width FLOAT64,                   -- Width in meters
  flag STRING,                     -- Flag state
  is_military BOOLEAN,             -- Military vessel flag
  is_research BOOLEAN,             -- Research vessel flag
  created_at TIMESTAMP,            -- Record creation time
  updated_at TIMESTAMP,            -- Last update time
  metadata JSON                    -- Additional vessel data
);
```

**Vessel Types**:
- `cargo` - Commercial cargo vessels
- `tanker` - Oil and chemical tankers
- `passenger` - Cruise ships and ferries
- `fishing` - Fishing vessels
- `military` - Military vessels
- `research` - Research and survey vessels
- `unknown` - Unclassified vessels

### Vessel Positions
**Table**: `vessel_positions`
**Purpose**: Real-time AIS position data

```sql
CREATE TABLE vessel_positions (
  id STRING NOT NULL,              -- Unique position identifier
  mmsi STRING NOT NULL,            -- Vessel MMSI
  timestamp TIMESTAMP NOT NULL,    -- Position timestamp
  coordinates GEOGRAPHY NOT NULL,  -- GPS coordinates
  speed FLOAT64,                   -- Speed in knots
  course FLOAT64,                  -- Course in degrees
  heading FLOAT64,                 -- Heading in degrees
  status STRING NOT NULL,          -- Navigation status
  created_at TIMESTAMP,            -- Record creation time
  partition_date DATE NOT NULL     -- Partition key
);
```

**Navigation Statuses**:
- `underway` - Vessel moving under power
- `anchored` - Vessel at anchor
- `moored` - Vessel tied to dock/mooring
- `aground` - Vessel run aground
- `not_under_command` - Vessel not under command
- `restricted_maneuverability` - Vessel with restricted movement
- `unknown` - Unknown status

### Incidents
**Table**: `incidents`
**Purpose**: Security incidents and alerts

```sql
CREATE TABLE incidents (
  id STRING NOT NULL,              -- Unique incident identifier
  type STRING NOT NULL,            -- Incident type
  severity STRING NOT NULL,        -- Severity level
  timestamp TIMESTAMP NOT NULL,    -- Incident time
  coordinates GEOGRAPHY NOT NULL,  -- Incident location
  description STRING NOT NULL,     -- Incident description
  status STRING NOT NULL,          -- Incident status
  vessels ARRAY<STRING> NOT NULL,  -- Involved vessel MMSIs
  metadata JSON,                   -- Additional incident data
  created_at TIMESTAMP,            -- Record creation time
  updated_at TIMESTAMP,            -- Last update time
  partition_date DATE NOT NULL     -- Partition key
);
```

**Incident Types**:
- `proximity_alert` - Vessel near restricted area
- `rendezvous_detected` - Suspicious vessel meeting
- `loitering_detected` - Extended presence in area
- `sanctions_violation` - Vessel on sanctions list
- `shadow_tracking` - Vessel turned off AIS
- `restricted_area_breach` - Unauthorized entry

**Severity Levels**:
- `low` - Minor concern
- `medium` - Moderate concern
- `high` - High concern
- `critical` - Immediate action required

### Restricted Areas
**Table**: `restricted_areas`
**Purpose**: Military and environmental protection zones

```sql
CREATE TABLE restricted_areas (
  id STRING NOT NULL,              -- Unique area identifier
  name STRING NOT NULL,            -- Area name
  type STRING NOT NULL,            -- Area type
  coordinates GEOGRAPHY NOT NULL,  -- Area boundary
  description STRING,              -- Area description
  restrictions ARRAY<STRING>       -- List of restrictions
);
```

**Area Types**:
- `military` - Military training areas
- `environmental` - Marine protected areas
- `infrastructure` - Critical infrastructure zones

### Cable Routes
**Table**: `cable_routes`
**Purpose**: Submarine cable infrastructure

```sql
CREATE TABLE cable_routes (
  id STRING NOT NULL,              -- Unique route identifier
  name STRING NOT NULL,            -- Route name
  coordinates GEOGRAPHY NOT NULL,  -- Cable path
  description STRING,              -- Route description
  criticality STRING NOT NULL      -- Criticality level
);
```

**Criticality Levels**:
- `high` - Critical infrastructure
- `medium` - Important infrastructure
- `low` - Standard infrastructure

### Sanctions
**Table**: `sanctions`
**Purpose**: Vessel blacklist and sanctions

```sql
CREATE TABLE sanctions (
  id STRING NOT NULL,              -- Unique sanction identifier
  mmsi STRING,                     -- Vessel MMSI (if known)
  name STRING,                     -- Entity name
  reason STRING NOT NULL,          -- Sanction reason
  source STRING NOT NULL,          -- Sanction source
  effective_date DATE NOT NULL,    -- When sanction takes effect
  expiry_date DATE,                -- When sanction expires
  is_active BOOLEAN NOT NULL       -- Whether sanction is active
);
```

### Analytics
**Table**: `analytics`
**Purpose**: Aggregated metrics and trends

```sql
CREATE TABLE analytics (
  id STRING NOT NULL,              -- Unique metric identifier
  metric_name STRING NOT NULL,     -- Metric name
  metric_value FLOAT64 NOT NULL,   -- Metric value
  coordinates GEOGRAPHY,           -- Geographic location
  bounding_box GEOGRAPHY,          -- Geographic bounds
  time_period STRING NOT NULL,     -- Time aggregation period
  start_time TIMESTAMP NOT NULL,   -- Period start
  end_time TIMESTAMP NOT NULL,     -- Period end
  metadata JSON,                   -- Additional metric data
  partition_date DATE NOT NULL     -- Partition key
);
```

**Time Periods**:
- `hourly` - Hourly aggregations
- `daily` - Daily aggregations
- `weekly` - Weekly aggregations
- `monthly` - Monthly aggregations

### Alerts
**Table**: `alerts`
**Purpose**: Real-time alerts for UI

```sql
CREATE TABLE alerts (
  id STRING NOT NULL,              -- Unique alert identifier
  type STRING NOT NULL,            -- Alert type
  severity STRING NOT NULL,        -- Alert severity
  message STRING NOT NULL,         -- Alert message
  timestamp TIMESTAMP NOT NULL,    -- Alert time
  coordinates GEOGRAPHY NOT NULL,  -- Alert location
  vessel_mmsi STRING,              -- Related vessel
  incident_id STRING,              -- Related incident
  is_acknowledged BOOLEAN,         -- Acknowledgment status
  acknowledged_by STRING,          -- Who acknowledged
  acknowledged_at TIMESTAMP,       -- When acknowledged
  partition_date DATE NOT NULL     -- Partition key
);
```

## Data Relationships

### Primary Keys
- **Vessels**: `mmsi` (Maritime Mobile Service Identity)
- **Positions**: `id` (UUID)
- **Incidents**: `id` (UUID)
- **Areas**: `id` (UUID)
- **Cables**: `id` (UUID)
- **Sanctions**: `id` (UUID)
- **Analytics**: `id` (UUID)
- **Alerts**: `id` (UUID)

### Foreign Keys
- **Positions** → **Vessels**: `mmsi`
- **Incidents** → **Vessels**: `vessels[]` (MMSI array)
- **Alerts** → **Vessels**: `vessel_mmsi`
- **Alerts** → **Incidents**: `incident_id`

### Spatial Relationships
- **Positions** ↔ **Restricted Areas**: Proximity queries
- **Positions** ↔ **Cable Routes**: Proximity queries
- **Incidents** ↔ **Areas**: Geographic containment
- **Analytics** ↔ **Areas**: Geographic aggregation

## Data Partitioning Strategy

### Date-Based Partitioning
- **Vessel Positions**: Partitioned by `partition_date`
- **Incidents**: Partitioned by `partition_date`
- **Analytics**: Partitioned by `partition_date`
- **Alerts**: Partitioned by `partition_date`

### Clustering Strategy
- **Positions**: Clustered by `mmsi`, `status`
- **Incidents**: Clustered by `type`, `severity`, `status`
- **Analytics**: Clustered by `metric_name`, `time_period`
- **Alerts**: Clustered by `type`, `severity`, `is_acknowledged`

## Data Retention Policies

### BigQuery Retention
- **Vessel Positions**: 90 days
- **Incidents**: 1 year
- **Analytics**: 5 years
- **Other Tables**: Indefinite

### Firestore Retention
- **Real-time Data**: 30 days
- **User Preferences**: Indefinite
- **Session Data**: 24 hours

## Data Quality and Validation

### Input Validation
- **Coordinates**: Valid latitude/longitude ranges
- **MMSI**: 9-digit numeric format
- **Timestamps**: ISO 8601 format
- **Speeds**: Non-negative values
- **Courses**: 0-360 degree range

### Data Integrity
- **Referential Integrity**: Foreign key constraints
- **Spatial Validation**: Valid geometry objects
- **Temporal Consistency**: Logical timestamp ordering
- **Business Rules**: Vessel type validation

## Performance Optimization

### Indexing Strategy
- **Primary Keys**: Automatic indexing
- **Spatial Indexes**: GIS function optimization
- **Composite Indexes**: Multi-column queries
- **Partial Indexes**: Filtered data access

### Query Optimization
- **Partition Pruning**: Date-based filtering
- **Clustering**: Related data co-location
- **Materialized Views**: Complex aggregations
- **Query Caching**: Repeated query results

## Data Security

### Access Control
- **Row-Level Security**: User-based filtering
- **Column-Level Security**: Sensitive data masking
- **Audit Logging**: Data access tracking
- **Encryption**: Data at rest and in transit

### Privacy Protection
- **Data Anonymization**: Personal data removal
- **Geographic Blurring**: Precise location masking
- **Time Delays**: Real-time data delays
- **Access Logging**: User activity tracking
