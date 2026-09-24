#!/usr/bin/env ts-node

import axios from 'axios';
import https from 'https';
import { BigQuery } from '@google-cloud/bigquery';

interface AISRecordRaw {
  [key: string]: any;
}

function parseAOIBounds(aoiWkt: string): { north: number; south: number; east: number; west: number } {
  try {
    const coordMatch = aoiWkt.match(/\(\(([^)]+)\)\)/);
    if (coordMatch) {
      const coords = coordMatch[1]
        .split(',')
        .map(pair => {
          const [lon, lat] = pair.trim().split(' ').map(Number);
          return { lon, lat };
        });
      const lats = coords.map(c => c.lat);
      const lons = coords.map(c => c.lon);
      return {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lons),
        west: Math.min(...lons)
      };
    }
  } catch {}
  return { north: 90, south: -90, east: 180, west: -180 };
}

async function main() {
  const PROJECT_ID = process.env.PROJECT_ID || 'svalmap';
  const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
  const AOI_WKT = process.env.AOI_WKT || '';
  const BARENTSWATCH_API_TOKEN = process.env.BARENTSWATCH_API_TOKEN;

  if (!BARENTSWATCH_API_TOKEN) {
    console.error('Missing BARENTSWATCH_API_TOKEN env var');
    process.exit(1);
  }

  const bounds = AOI_WKT ? parseAOIBounds(AOI_WKT) : { north: 81, south: 70, east: 35, west: 10 };

  const bq = new BigQuery({ projectId: PROJECT_ID });

  // Ensure staging table exists
  const datasetName = BQ_DATASET.split('.')[1];
  const staging = bq.dataset(datasetName).table('vessel_positions_wkt');
  const [stagingExists] = await staging.exists();
  if (!stagingExists) {
    await staging.create({
      schema: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'mmsi', type: 'STRING', mode: 'REQUIRED' },
        { name: 'timestamp', type: 'STRING', mode: 'REQUIRED' },
        { name: 'coordinates_wkt', type: 'STRING', mode: 'REQUIRED' },
        { name: 'speed', type: 'FLOAT' },
        { name: 'course', type: 'FLOAT' },
        { name: 'heading', type: 'FLOAT' },
        { name: 'status', type: 'STRING', mode: 'REQUIRED' },
        { name: 'created_at', type: 'STRING', mode: 'REQUIRED' }
      ]
    });
  }

  // Time window last 10 minutes
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

  // Fetch AIS (use Live AIS endpoint)
  const axiosInstance = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
  const resp = await axiosInstance.get('https://live.ais.barentswatch.no/v1/latest/combined', {
    headers: { Authorization: `Bearer ${BARENTSWATCH_API_TOKEN}`, 'User-Agent': 'SvalMap-Runner/1.0' },
    timeout: 30000
  });

  const data: AISRecordRaw[] = Array.isArray(resp.data) ? resp.data : (resp.data?.data || []);
  if (data.length === 0) {
    console.log('No AIS data returned');
    return;
  }

  // Filter to AOI bbox
  const getNum = (obj: any, keys: string[], def?: number): number | undefined => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return Number(obj[k]);
    }
    return def;
  };
  const getStr = (obj: any, keys: string[], def?: string): string | undefined => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return String(obj[k]);
    }
    return def;
  };

  const mapped = data.map(r => {
    const lat = getNum(r, ['latitude', 'lat', 'Latitude', 'Lat']);
    const lon = getNum(r, ['longitude', 'lon', 'Longitude', 'Lon']);
    const ts = getStr(r, ['timestamp', 'timeOfPosition', 'time', 'positionTime', 'recieved', 'msgtime'], new Date().toISOString());
    const sog = getNum(r, ['sog', 'speedOverGround', 'speed'], undefined);
    const cog = getNum(r, ['cog', 'courseOverGround', 'course'], undefined);
    const hdg = getNum(r, ['heading', 'trueHeading', 'hdg'], undefined);
    const stat = getStr(r, ['navStat', 'status', 'navigationStatus'], '');
    const mmsiVal = getNum(r, ['mmsi', 'MMSI'], 0) || 0;
    return { mmsi: mmsiVal, latitude: lat, longitude: lon, timestamp: ts as string, speed: sog, course: cog, heading: hdg, status: stat };
  }).filter(x => typeof x.latitude === 'number' && typeof x.longitude === 'number' && x.mmsi);

  const filtered = mapped.filter(r => r.latitude! >= bounds.south && r.latitude! <= bounds.north && r.longitude! >= bounds.west && r.longitude! <= bounds.east);
  if (filtered.length === 0) {
    console.log('No AIS data in AOI');
    return;
  }

  // Prepare staging rows
  const rows = filtered.map(r => ({
    id: `${r.mmsi}_${r.timestamp}`,
    mmsi: String(r.mmsi),
    timestamp: new Date(r.timestamp).toISOString(),
    coordinates_wkt: `POINT(${r.longitude} ${r.latitude})`,
    speed: r.speed ?? null,
    course: r.course ?? null,
    heading: r.heading ?? null,
    status: String(r.status ?? ''),
    created_at: new Date().toISOString()
  }));

  await staging.insert(rows as any);

  // DML into final table, cast WKT to GEOGRAPHY and compute partition_date
  const insertSql = `
    INSERT INTO \`${BQ_DATASET}.vessel_positions\`
      (id, mmsi, timestamp, coordinates, speed, course, heading, status, created_at, partition_date)
    SELECT id,
           mmsi,
           TIMESTAMP(timestamp) AS timestamp,
           ST_GEOGFROMTEXT(coordinates_wkt) AS coordinates,
           speed, course, heading,
           status,
           TIMESTAMP(created_at) AS created_at,
           DATE(TIMESTAMP(timestamp)) AS partition_date
    FROM \`${BQ_DATASET}.vessel_positions_wkt\`
    WHERE SAFE.ST_GEOGFROMTEXT(coordinates_wkt) IS NOT NULL`;

  await bq.query({ query: insertSql, useLegacySql: false });

  console.log(`Inserted ${rows.length} records into ${BQ_DATASET}.vessel_positions`);
}

main().catch(err => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});


