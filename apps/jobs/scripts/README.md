# SvalMap Data Loader Scripts

This directory contains TypeScript scripts for loading various data sources into BigQuery for the SvalMap maritime monitoring system.

## Prerequisites

1. **Google Cloud SDK**: Ensure `gcloud` and `bq` commands are available
2. **GDAL/OGR**: Install `ogr2ogr` for shapefile processing
3. **Environment Variables**: Set `BQ_DATASET` (defaults to `svalmap.marine_osint`)
4. **Authentication**: Ensure you're authenticated with `gcloud auth login`

## Scripts

### 1. `loadAssets.ts` - Geographic Asset Loader

Loads various geographic data files into the `assets` table:

- **NSM Restricted Areas**: Land polygons, sea polygons, sea vectors, markers
- **Svalbard EEZ**: Exclusive Economic Zone boundaries
- **Cable Routes**: Submarine cable data

**Features:**
- Automatically reprojects to WGS84 (EPSG:4326)
- Creates 1nm and 3nm buffers around features
- Handles SHP, GML, and GeoJSON formats
- Bulk inserts into BigQuery with proper GEOGRAPHY types

**Usage:**
```bash
npm run load:assets
```

**Output Table Schema:**
```sql
CREATE TABLE assets (
  feature_id STRING NOT NULL,
  name STRING,
  type STRING NOT NULL,
  source STRING,
  updated_at TIMESTAMP,
  geog GEOGRAPHY NOT NULL,
  buffer_1nm GEOGRAPHY,
  buffer_3nm GEOGRAPHY
);
```

## Available NPM Scripts

| Script | Description | Command |
|--------|-------------|---------|
| `load:assets` | Load geographic assets (restricted areas, cables, EEZ) | `npm run load:assets` |
| `load:norwatch` | Load Norwegian military vessel watchlist | `npm run load:norwatch` |
| `derive:aoi` | Derive unified Area of Interest | `npm run derive:aoi` |
| `load:sanctions` | Load sanctions data from international sources | `npm run load:sanctions` |
| `load:shadowfleet` | Load shadow fleet vessel data | `npm run load:shadowfleet` |

### 2. `loadNorMilWatchlist.ts` - Norwegian Military Vessel Watchlist

Loads Norwegian military vessel MMSI numbers into the `watchlist_mmsi` table.

**Features:**
- Flexible parsing for various text formats (tab, comma, space-separated)
- Automatic MMSI validation (9-digit numbers)
- Handles header lines and malformed data gracefully
- Bulk inserts into BigQuery

**Usage:**
```bash
npm run load:norwatch
```

**Output Table Schema:**
```sql
CREATE TABLE watchlist_mmsi (
  mmsi INT64 NOT NULL,
  name STRING,
  source STRING,
  notes STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 3. `deriveAOI.ts` - Area of Interest Derivation

Creates a unified Area of Interest (AOI) from Svalbard EEZ data.

**Features:**
- Reads all Svalbard EEZ shapefiles
- Unions multiple polygons into a single boundary
- Calculates area and bounding box
- Outputs both GeoJSON and WKT formats
- Prints WKT to stdout for job configuration

**Usage:**
```bash
npm run derive:aoi
```

**Output Files:**
- `data/aoi.geojson` - GeoJSON format for visualization
- `data/aoi.wkt` - Well-Known Text format for spatial queries

### 4. `loadSanctions.ts` - Sanctions Data Loader

Fetches and loads sanctions data from multiple international sources.

**Features:**
- **EU Sanctions**: XML-based sanctions list
- **OFAC SDN**: US Treasury Specially Designated Nationals
- **UK HMT**: UK Treasury sanctions list
- Automatic marine vessel filtering
- MMSI/IMO extraction from remarks
- Bulk insert into BigQuery

**Usage:**
```bash
npm run load:sanctions
```

**Output Table Schema:**
```sql
CREATE TABLE sanctions_mmsi (
  mmsi INT64,
  imo STRING,
  name STRING NOT NULL,
  source STRING NOT NULL,
  source_id STRING NOT NULL,
  entity_type STRING,
  country STRING,
  reason STRING,
  effective_date STRING,
  last_updated STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 5. `loadShadowFleet.ts` - Shadow Fleet Data Loader

Loads shadow fleet vessel data from local CSV files.

**Features:**
- Reads shadow fleet CSV with flexible parsing
- Risk level classification (LOW, MEDIUM, HIGH, CRITICAL)
- MMSI and IMO validation
- Automatic sample data generation if file missing
- Bulk insert into BigQuery

**Usage:**
```bash
npm run load:shadowfleet
```

**Output Table Schema:**
```sql
CREATE TABLE shadowfleet_mmsi (
  mmsi INT64,
  imo STRING,
  name STRING NOT NULL,
  last_known_flag STRING NOT NULL,
  vessel_type STRING NOT NULL,
  source STRING NOT NULL,
  notes STRING,
  risk_level STRING NOT NULL,
  last_seen STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## Data Sources

### Expected File Structure
```
data/source/
├── NSM/
│   ├── land polygon.shp
│   ├── sea polygon.shp
│   ├── sea vector.shp
│   └── markers.shp
├── SvalbardEEZ/
│   └── Svalbard EEZ.shp
└── SvalbardCables.geojson
```

### Norwegian Military Vessel MMSI
```
data/source/
└── Norwegian-military-vessel-mmsi.txt
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BQ_DATASET` | `svalmap.marine_osint` | BigQuery dataset for data storage |
| `GOOGLE_APPLICATION_CREDENTIALS` | - | Path to service account key (optional) |

## Error Handling

All scripts include comprehensive error handling:

- **File Not Found**: Graceful fallback with warnings
- **Parse Errors**: Skip problematic lines with detailed logging
- **BigQuery Errors**: Detailed error reporting and rollback
- **GDAL Failures**: Fallback to alternative processing methods

## Logging

Scripts provide detailed console output:

- 🚀 Process start information
- 📖 File processing progress
- ✅ Success confirmations
- ⚠️  Warnings for non-critical issues
- ❌ Error details with context
- 📊 Summary statistics

## Performance Considerations

- **Bulk Inserts**: All data is inserted in single BigQuery operations
- **Memory Management**: Large files are processed incrementally
- **Parallel Processing**: Where possible, multiple files are processed concurrently
- **Error Recovery**: Failed operations don't affect successful ones

## Troubleshooting

### Common Issues

1. **GDAL Not Found**: Install GDAL/OGR tools
   ```bash
   # macOS
   brew install gdal
   
   # Ubuntu/Debian
   sudo apt-get install gdal-bin
   ```

2. **BigQuery Authentication**: Ensure proper credentials
   ```bash
   gcloud auth login
   gcloud config set project svalmap
   ```

3. **File Permissions**: Ensure read access to data files
   ```bash
   chmod 644 data/source/**/*
   ```

### Debug Mode

For detailed debugging, scripts can be run with additional logging:

```bash
DEBUG=* npm run load:assets
```

## Dependencies

- `@google-cloud/bigquery`: BigQuery client library
- `@turf/turf`: Geospatial operations (fallback)
- `ogr2ogr`: Command-line GIS processing (via child_process)

## Contributing

When adding new data sources:

1. Update the source definitions in the relevant script
2. Add appropriate error handling
3. Include validation for the new data format
4. Update this README with new source information
5. Test with sample data before production use
