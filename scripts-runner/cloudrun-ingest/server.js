/* eslint-disable */
const express = require('express');
const axios = require('axios');
const https = require('https');
const { BigQuery } = require('@google-cloud/bigquery');

const app = express();
app.use(express.json());

const PROJECT_ID = process.env.PROJECT_ID || 'svalmap';
const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const PORT = process.env.PORT || 8080;

function parseAOIBounds(aoiWkt) {
  try {
    const m = (aoiWkt || '').match(/\(\(([^)]+)\)\)/);
    if (m) {
      const coords = m[1].split(',').map(p => {
        const [lon, lat] = p.trim().split(' ').map(Number);
        return { lon, lat };
      });
      const lats = coords.map(c => c.lat);
      const lons = coords.map(c => c.lon);
      return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) };
    }
  } catch {}
  return { north: 81, south: 70, east: 35, west: 10 };
}

async function deriveAoiWktFromBigQuery(bq) {
  try {
    const [rows] = await bq.query({
      query: `SELECT ST_ASTEXT(ST_UNION_AGG(geog)) AS wkt FROM \`${BQ_DATASET}.assets\` WHERE type='FISHERY_PROTECTION_SVALBARD'`,
      useLegacySql: false
    });
    const wkt = rows && rows[0] && rows[0].wkt;
    if (typeof wkt === 'string' && wkt.length > 0) return wkt;
  } catch (e) {
    console.warn('AOI_WKT from BigQuery failed, falling back to defaults', e && e.message);
  }
  return '';
}

async function ingestOnce(options = {}) {
  const bq = new BigQuery({ projectId: PROJECT_ID });
  const AOI_WKT = process.env.AOI_WKT || (await deriveAoiWktFromBigQuery(bq));
  const bounds = parseAOIBounds(AOI_WKT);

  const clientId = process.env.BW_CLIENT_ID;
  const clientSecret = process.env.BW_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing BW_CLIENT_ID / BW_CLIENT_SECRET');

  // Token
  const tokenResp = await axios.post('https://id.barentswatch.no/connect/token', new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'ais',
    grant_type: 'client_credentials'
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const accessToken = tokenResp.data && tokenResp.data.access_token;
  if (!accessToken) throw new Error('No access token received');

  // Fetch latest positions
  const axiosInstance = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
  const resp = await axiosInstance.get('https://live.ais.barentswatch.no/v1/latest/combined', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'SvalMap-CloudRun/1.0' },
    timeout: 30000
  });
  const rows = Array.isArray(resp.data) ? resp.data : [];
  if (!rows.length) return { inserted: 0 };

  // Map and filter to AOI bbox
  const getNum = (o, ks) => { for (const k of ks) if (o[k] != null) return Number(o[k]); };
  const getStr = (o, ks, d) => { for (const k of ks) if (o[k] != null) return String(o[k]); return d; };
  const mapped = rows.map(r => {
    const lat = getNum(r, ['latitude', 'lat']);
    const lon = getNum(r, ['longitude', 'lon']);
    const ts = getStr(r, ['msgtime', 'timestamp'], new Date().toISOString());
    const sog = getNum(r, ['speedOverGround', 'sog']);
    const cog = getNum(r, ['courseOverGround', 'cog']);
    const hdg = getNum(r, ['trueHeading', 'heading']);
    const stat = getStr(r, ['navigationalStatus', 'status'], '');
    const mmsi = getNum(r, ['mmsi']) || 0;
    return { mmsi, latitude: lat, longitude: lon, timestamp: ts, speed: sog, course: cog, heading: hdg, status: stat };
  }).filter(x => typeof x.latitude === 'number' && typeof x.longitude === 'number' && x.mmsi);

  const filtered = mapped.filter(r => r.latitude >= bounds.south && r.latitude <= bounds.north && r.longitude >= bounds.west && r.longitude <= bounds.east);
  if (!filtered.length) return { inserted: 0 };

  const datasetName = BQ_DATASET.split('.')[1];
  const staging = bq.dataset(datasetName).table('vessel_positions_wkt');
  const [exists] = await staging.exists();
  if (!exists) {
    await staging.create({ schema: [
      { name: 'id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'mmsi', type: 'STRING', mode: 'REQUIRED' },
      { name: 'timestamp', type: 'STRING', mode: 'REQUIRED' },
      { name: 'coordinates_wkt', type: 'STRING', mode: 'REQUIRED' },
      { name: 'speed', type: 'FLOAT' },
      { name: 'course', type: 'FLOAT' },
      { name: 'heading', type: 'FLOAT' },
      { name: 'status', type: 'STRING', mode: 'REQUIRED' },
      { name: 'created_at', type: 'STRING', mode: 'REQUIRED' }
    ]});
  }

  const insertRows = filtered.map(r => ({
    id: `${r.mmsi}_${r.timestamp}`,
    mmsi: String(r.mmsi),
    timestamp: new Date(r.timestamp).toISOString(),
    coordinates_wkt: `POINT(${r.longitude} ${r.latitude})`,
    speed: r.speed ?? null,
    course: r.course ?? null,
    heading: r.heading ?? null,
    status: String(r.status || ''),
    created_at: new Date().toISOString()
  }));

  await staging.insert(insertRows);
  const insertSql = `
    INSERT INTO \`${BQ_DATASET}.vessel_positions\`
      (id, mmsi, timestamp, coordinates, speed, course, heading, status, created_at, partition_date)
    SELECT id, mmsi, TIMESTAMP(timestamp), ST_GEOGFROMTEXT(coordinates_wkt), speed, course, heading, status,
           TIMESTAMP(created_at), DATE(TIMESTAMP(timestamp))
    FROM \`${BQ_DATASET}.vessel_positions_wkt\`
    WHERE SAFE.ST_GEOGFROMTEXT(coordinates_wkt) IS NOT NULL`;
  await bq.query({ query: insertSql, useLegacySql: false });
  return { inserted: insertRows.length };
}

app.get('/run', async (_req, res) => {
  try {
    const result = await ingestOnce();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Cloud Run ingest listening on ${PORT}`));


