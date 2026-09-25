import { Router } from 'express';
import axios from 'axios';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { featureCollection, point, polygon } from '@turf/helpers';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

const router = Router();

const REPO_ROOT = process.env.SVALMAP_ROOT
  ? path.resolve(process.env.SVALMAP_ROOT)
  : path.resolve(__dirname, '../../../..');
const AOI_BASE_PATH = path.join(REPO_ROOT, 'data/source/Proximity markers/AOI');
const PROXIMITY_BASE_PATH = path.join(REPO_ROOT, 'data/source/Proximity markers');
const SANCTIONS_DIR = path.join(REPO_ROOT, 'data/cache/sanctions');
const SHADOW_CSV = path.join(REPO_ROOT, 'data/source/shadowfleet.csv');
const SHADOW_CSV2 = path.join(REPO_ROOT, 'data/source/shadowfleet2.csv');
const EU_DESIGNATED = path.join(REPO_ROOT, 'data/source/eu-designated-vessels.csv');
const SANCTION_LIST = path.join(REPO_ROOT, 'data/source/Sanctionlist.CSV');

function loadGeoJSON(file: string): any {
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  return data as any;
}

function isRussianOrFlagged(v: any, sanctions: Set<string>, shadow: Set<string>): boolean {
  const mmsi = String(v.mmsi ?? '');
  const imo = String(v.imo ?? '').toUpperCase();
  const mid = mmsi.slice(0, 3);
  const isRussian = mid === '273';
  const isSanctioned = sanctions.has(imo) || sanctions.has(mmsi);
  const isShadow = shadow.has(imo) || shadow.has(mmsi);
  return isRussian || isSanctioned || isShadow;
}

async function fetchLiveAIS(fromISO?: string, toISO?: string): Promise<any[]> {
  const token = process.env.BARENTSWATCH_API_TOKEN;
  if (!token) throw new Error('Missing BARENTSWATCH_API_TOKEN');
  const params: any = {};
  if (fromISO) params.from = fromISO;
  if (toISO) params.to = toISO;
  params.per_page = 1000;
  params.page = 1;
  const { data } = await axios.get('https://api.barentswatch.no/vessel/v1/ais', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'SvalMap-API/1.0',
    },
    params,
    timeout: 30000,
  });
  return data?.data ?? [];
}

function withinAOI(v: any, aoi: any): boolean {
  const candidate = point([v.longitude, v.latitude]);
  for (const f of aoi.features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      if (booleanPointInPolygon(candidate as any, f as any)) return true;
    }
    if (f.geometry.type === 'MultiPolygon') {
      const multi = f as any;
      for (const coords of multi.geometry.coordinates) {
        const poly = polygon(coords as any);
        if (booleanPointInPolygon(candidate as any, poly as any)) return true;
      }
    }
  }
  return false;
}

// Load sanctions cache (simple local cache using data/cache/sanctions)
function loadSanctionsAndShadow(): { sanctions: Set<string>; shadow: Set<string> } {
  const sanctions = new Set<string>();
  const shadow = new Set<string>();
  try {
    if (existsSync(SANCTIONS_DIR)) {
      for (const name of readdirSync(SANCTIONS_DIR)) {
        if (!name.endsWith('.txt')) continue;
        const body = readFileSync(path.join(SANCTIONS_DIR, name), 'utf-8');
        for (const line of body.split(/\r?\n/)) {
          const t = line.trim();
          if (t) sanctions.add(t.toUpperCase());
        }
      }
    }
  } catch {}
  for (const file of [SANCTION_LIST, EU_DESIGNATED]) {
    try {
      if (!existsSync(file)) continue;
      const body = readFileSync(file, 'utf-8');
      for (const line of body.split(/\r?\n/)) {
        const m = line.match(/\b(\d{7,9})\b/);
        if (m) sanctions.add(m[1]);
        const mmsi = line.match(/\b(\d{9})\b/);
        if (mmsi) sanctions.add(mmsi[1]);
      }
    } catch {}
  }
  for (const file of [SHADOW_CSV, SHADOW_CSV2]) {
    try {
      if (!existsSync(file)) continue;
      const csv = readFileSync(file, 'utf-8');
      for (const line of csv.split(/\r?\n/)) {
        const parts = line.split(/[,;]/).map((s) => s?.trim());
        for (const p of parts) {
          if (p && /^\d{7,9}$/.test(p)) shadow.add(p.toUpperCase());
        }
      }
    } catch {}
  }
  return { sanctions, shadow };
}

// GET /api/v1/vessels/live?area=Svalbard|JanMayen|Norway
router.get('/live', async (req, res) => {
  try {
    const area = String(req.query.area || 'Svalbard');
    const filename = `${area.replace(/\s+/g, '')}.geojson`;
    const aoi = loadGeoJSON(path.join(AOI_BASE_PATH, filename));
    const { sanctions, shadow } = loadSanctionsAndShadow();

    const records = await fetchLiveAIS();
    let vessels = records.filter(v => withinAOI(v, aoi));

    if (area === 'JanMayen' || area === 'Norway') {
      vessels = vessels.filter(v => isRussianOrFlagged(v, sanctions, shadow));
    }

    return res.json({ success: true, data: vessels, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /api/v1/vessels/proximity?type=petroleum|pipelines|cables&radius_m=300
router.get('/proximity', async (req, res) => {
  try {
    const type = String(req.query.type || 'petroleum').toLowerCase();
    const radiusMeters = Math.max(10, Math.min(5000, parseInt(String(req.query.radius_m || '300'), 10)));

    const infraMap: Record<string, string> = {
      petroleum: 'Petroleuminstallations.geojson',
      pipelines: 'Pipelines.geojson',
      cables: 'Underseacables.geojson',
    };
    const infra = loadGeoJSON(path.join(PROXIMITY_BASE_PATH, infraMap[type]));

    const { sanctions, shadow } = loadSanctionsAndShadow();
    const records = await fetchLiveAIS();

    // Only Russian/sanctioned/shadow
    const filtered = records.filter(v => isRussianOrFlagged(v, sanctions, shadow));

    // Proximity test (coarse: haversine approximate by turf buffer on each feature and point-in-polygon)
    const turf = await import('@turf/turf');
    const near: any[] = [];
    const buffers: any = featureCollection(
      infra.features.map((f: any) => (turf as any).buffer(f, radiusMeters, { units: 'meters' }))
    );
    for (const v of filtered) {
      const pt = point([v.longitude, v.latitude]);
      let isNear = false;
      for (const b of buffers.features) {
        if (booleanPointInPolygon(pt, b as any)) { isNear = true; break; }
      }
      if (isNear) near.push(v);
    }

    return res.json({ success: true, data: near, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

export default router;


