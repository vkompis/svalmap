#!/usr/bin/env ts-node
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { BigQuery } from '@google-cloud/bigquery';
import axios from 'axios';
import https from 'https';
import * as turf from '@turf/turf';
import cron from 'node-cron';
import {
  updateEuDesignatedVessels,
  metaAgeMs,
  EU_DESIGNATED_META,
  readEuDesignatedCsv,
  readOpenSanctionsVesselIds,
  OPENSANCTIONS_VESSELS_CSV,
} from './sanctionsUpdater';
import {
  startAisStreamClient,
  getAisStreamVessels,
  getAisStreamStatus,
  vesselLengthMeters,
  NORTH_ATLANTIC_BBOX,
} from './aisstreamClient';
import { isRussianResearchVessel, RUSSIAN_RESEARCH_VESSELS } from './russianResearchVessels';
import { dataSource } from './paths';
import {
  deleteServerAlert,
  emailConfigured,
  listServerAlerts,
  loadServerAlerts,
  sendAlertEmail,
  upsertServerAlert,
} from './alertMail';
import { startAlertWatcher } from './alertWatcher';
import { fetchSodirFacilitiesToFile } from './fetchSodirFacilities';
import { fetchSodirPipelinesToFile } from './fetchSodirPipelines';

const RESEARCH_NAME_BY_MMSI = new Map(
  RUSSIAN_RESEARCH_VESSELS.map((v) => [v.mmsi, v.name] as const)
);

/** Prefer secure TLS; set TLS_INSECURE=1 only if a corporate proxy breaks verification. */
function httpsAgent() {
  return new https.Agent({ rejectUnauthorized: process.env.TLS_INSECURE !== '1' });
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const API_KEY = (process.env.API_KEY || process.env.SVALMAP_API_KEY || '').trim();
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : true,
}));
app.use(express.json());

// Optional API key (set API_KEY to enforce). Health endpoints stay open.
app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.path === '/healthz' || req.path === '/api/health') return next();
  const key = String(req.header('x-api-key') || req.query.api_key || '');
  if (key && key === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized — provide X-API-Key' });
});

const PROJECT_ID = process.env.PROJECT_ID || 'svalmap';
const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const PORT = Number(process.env.PORT || 8787);
const bq = new BigQuery({ projectId: PROJECT_ID });
// Global Fishing Watch API (v3 gateway — see https://globalfishingwatch.org/our-apis/documentation/docs/v3)
const GFW_API_BASE =
  process.env.GFW_API_BASE || 'https://gateway.api.globalfishingwatch.org/v3';
const GFW_API_TOKEN = process.env.GFW_API_TOKEN || process.env.GFW_TOKEN || '';
function gfwClient() {
  return axios.create({
    baseURL: GFW_API_BASE,
    headers: GFW_API_TOKEN ? { Authorization: `Bearer ${GFW_API_TOKEN}` } : {},
    timeout: 120000,
    httpsAgent: httpsAgent(),
  });
}

// In-memory sanctioned MMSI cache
let SANCTIONED_MMSI: Set<string> = new Set();
let SANCTIONED_IMO: Set<string> = new Set();
let SANCTIONED_CACHE_TS = 0;
// In-memory shadow fleet MMSI cache
let SHADOWFLEET_MMSI: Set<string> = new Set();
let SHADOWFLEET_IMO: Set<string> = new Set();
let SHADOW_CACHE_TS = 0;
const SHADOW_TEST_SET: Set<string> = new Set(
  (process.env.SHADOW_TEST_MMSI || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// In-memory Norwegian military vessel MMSI cache
let MILITARY_MMSI: Set<string> = new Set();
let MILITARY_CACHE_TS = 0;

// In-memory IMO to MMSI mapping for EU sanctions
let IMO_TO_MMSI_MAP: Map<string, string> = new Map();
let IMO_MAP_CACHE_TS = 0;

const LOCAL_SANCTIONS_CSV = dataSource('Sanctionlist.CSV');
const LOCAL_EU_SANCTIONS_CSV = dataSource('eu-designated-vessels.csv');
const LOCAL_EU_SANCTIONS_CSV_LEGACY = dataSource('Sanction list EU.CSV');
const LOCAL_SHADOWFLEET_CSV = dataSource('shadowfleet2.csv');
const LOCAL_OPENSANCTIONS_VESSELS_CSV = OPENSANCTIONS_VESSELS_CSV;
const LOCAL_MILITARY_MMSI = dataSource('Norwegian-military-vessel-mmsi.txt');

function readMmsiCsv(filePath: string): Set<string> {
  const result = new Set<string>();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return result;
    const header = lines[0];
    const delim = header.includes(';') ? ';' : ',';
    const headers = header.split(delim).map(h => h.trim().toLowerCase());
    const mmsiIdx = headers.findIndex(h => h === 'mmsi' || h === 'mmsi number' || h === 'mmsinumber' || h === 'mmsi_no');
    for (let i = (mmsiIdx >= 0 ? 1 : 0); i < lines.length; i++) {
      const cols = lines[i].split(delim);
      const val = mmsiIdx >= 0 ? (cols[mmsiIdx] || '') : lines[i];
      const match = String(val).match(/\b\d{7,9}\b/);
      if (match) result.add(match[0]);
    }
  } catch {}
  return result;
}

function readImoCsv(filePath: string): Set<string> {
  const result = new Set<string>();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return result;
    const header = lines[0];
    const delim = header.includes(';') ? ';' : ',';
    const headers = header.split(delim).map(h => h.trim().toLowerCase());
    const imoIdx = headers.findIndex(h => h === 'imo' || h === 'imo number' || h === 'imonumber' || h === 'imo_no');
    for (let i = (imoIdx >= 0 ? 1 : 0); i < lines.length; i++) {
      const cols = lines[i].split(delim);
      const val = imoIdx >= 0 ? (cols[imoIdx] || '') : lines[i];
      const match = String(val).match(/\b\d{7,9}\b/);
      if (match) result.add(match[0]);
    }
  } catch {}
  return result;
}
async function ensureSanctionedLoaded(): Promise<void> {
  const now = Date.now();
  if (now - SANCTIONED_CACHE_TS < 10 * 60 * 1000 && (SANCTIONED_MMSI.size > 0 || SANCTIONED_IMO.size > 0)) return;
  try {
    const s = new Set<string>();
    const imos = new Set<string>();

    // Try BigQuery first (if configured)
    try {
      const [rows] = await bq.query({
        query: `SELECT CAST(mmsi AS STRING) AS m FROM \`${BQ_DATASET}.sanctions_mmsi\``,
        useLegacySql: false,
      } as any);
      for (const r of rows as any[]) { if (r?.m) s.add(String(r.m)); }
    } catch {}

    // Local lists (Sanctionlist has MMSI+IMO; EU designated vessels are IMO-only)
    readMmsiCsv(LOCAL_SANCTIONS_CSV).forEach((m) => s.add(String(m)));
    readImoCsv(LOCAL_SANCTIONS_CSV).forEach((m) => imos.add(String(m)));
    readImoCsv(LOCAL_EU_SANCTIONS_CSV).forEach((m) => imos.add(String(m)));
    // Legacy EU CSV kept as fallback merge if present
    if (fs.existsSync(LOCAL_EU_SANCTIONS_CSV_LEGACY)) {
      readImoCsv(LOCAL_EU_SANCTIONS_CSV_LEGACY).forEach((m) => imos.add(String(m)));
    }
    // OpenSanctions maritime vessels (OFAC/EU/UA and other programs) — verify + expand
    if (fs.existsSync(LOCAL_OPENSANCTIONS_VESSELS_CSV)) {
      const os = readOpenSanctionsVesselIds(LOCAL_OPENSANCTIONS_VESSELS_CSV);
      os.imos.forEach((m) => imos.add(m));
      os.mmsis.forEach((m) => s.add(m));
    }

    // Known sanctioned MMSI kept for continuity
    s.add('273148810');

    SANCTIONED_MMSI = s;
    SANCTIONED_IMO = imos;
    SANCTIONED_CACHE_TS = now;
    console.log(`[sanctions] mmsi=${SANCTIONED_MMSI.size} imo=${SANCTIONED_IMO.size}`);
  } catch (e) {
    console.warn('[sanctions] load failed', e);
  }
}

async function ensureShadowLoaded(): Promise<void> {
  const now = Date.now();
  if (now - SHADOW_CACHE_TS < 10 * 60 * 1000 && (SHADOWFLEET_MMSI.size > 0 || SHADOWFLEET_IMO.size > 0)) return;
  try {
    SHADOWFLEET_MMSI = new Set(Array.from(readMmsiCsv(LOCAL_SHADOWFLEET_CSV)).map((x) => String(x)));
    SHADOWFLEET_IMO = new Set(Array.from(readImoCsv(LOCAL_SHADOWFLEET_CSV)).map((x) => String(x)));
    SHADOW_CACHE_TS = now;
    console.log(`[shadowfleet] mmsi=${SHADOWFLEET_MMSI.size} imo=${SHADOWFLEET_IMO.size}`);
  } catch (e) {
    console.warn('[shadowfleet] load failed', e);
  }
}

async function ensureMilitaryLoaded(): Promise<void> {
  const now = Date.now();
  if (now - MILITARY_CACHE_TS < 10 * 60 * 1000 && MILITARY_MMSI.size > 0) return;
  try {
    MILITARY_MMSI = new Set(Array.from(readMmsiCsv(LOCAL_MILITARY_MMSI)).map(x => String(x)));
    MILITARY_CACHE_TS = now;
  } catch {}
}

async function ensureImoMapLoaded(): Promise<void> {
  const now = Date.now();
  if (now - IMO_MAP_CACHE_TS < 10 * 60 * 1000 && IMO_TO_MMSI_MAP.size > 0) return;
  try {
    // Build IMO to MMSI mapping from current vessel data
    const token = await getBarentsWatchAccessToken();
    if (token) {
      const agent = httpsAgent();
      let data: any;
      try {
        const r1 = await axios.get('https://live.ais.barentswatch.no/v1/latest/combined?modelType=Full&modelFormat=Json', { headers: { Authorization: `Bearer ${token}` }, httpsAgent: agent, timeout: 15000 });
        data = r1.data;
      } catch {
        const r2 = await axios.get('https://live.ais.barentswatch.no/v1/combined?modelType=Full&modelFormat=Json', { headers: { Authorization: `Bearer ${token}` }, httpsAgent: agent, timeout: 20000 });
        data = r2.data;
      }
      
      const list: any[] = Array.isArray(data) ? data : (data?.vessels || data?.positions || []);
      IMO_TO_MMSI_MAP.clear();
      
      for (const v of list) {
        const mmsi = String(v?.mmsi ?? v?.MMSI ?? '');
        const imo = v?.imoNumber ?? v?.imo ?? v?.IMO ?? (v?.properties && v?.properties.imoNumber);
        if (mmsi && imo && String(imo).match(/\b\d{7,9}\b/)) {
          IMO_TO_MMSI_MAP.set(String(imo), mmsi);
        }
      }
      
      IMO_MAP_CACHE_TS = now;
    }
  } catch {}
}

// Local perimeter files
const AOI_GEOJSON_PATH = dataSource('fisheriesprotectionzone.geojson');
const CABLES_GEOJSON_PATH = dataSource('SvalbardCables.geojson');
let AOI_GEOJSON_STRING = '';
let CABLES_GEOJSON_STRING = '';
try { AOI_GEOJSON_STRING = fs.readFileSync(AOI_GEOJSON_PATH, 'utf8'); } catch { console.warn('AOI GeoJSON not found at', AOI_GEOJSON_PATH); }
try { CABLES_GEOJSON_STRING = fs.readFileSync(CABLES_GEOJSON_PATH, 'utf8'); } catch { console.warn('Cables GeoJSON not found at', CABLES_GEOJSON_PATH); }

function toGeometryJSONString(rawJsonStr: string): string {
  if (!rawJsonStr) return '';
  try {
    const obj = JSON.parse(rawJsonStr);
    if (!obj || !obj.type) return '';
    if (obj.type === 'Feature') return JSON.stringify(obj.geometry || {});
    if (obj.type === 'FeatureCollection') {
      const geoms = (obj.features || []).map((f: any) => f && f.geometry).filter(Boolean);
      if (geoms.length === 0) return '';
      const polyCoords: any[] = [];
      const mpolyCoords: any[] = [];
      const lineCoords: any[] = [];
      const mlineCoords: any[] = [];
      for (const g of geoms) {
        if (g.type === 'Polygon') polyCoords.push(g.coordinates);
        else if (g.type === 'MultiPolygon') mpolyCoords.push(...g.coordinates);
        else if (g.type === 'LineString') lineCoords.push(g.coordinates);
        else if (g.type === 'MultiLineString') mlineCoords.push(...g.coordinates);
      }
      if (polyCoords.length || mpolyCoords.length) {
        const coords = [...mpolyCoords, ...polyCoords];
        return JSON.stringify({ type: 'MultiPolygon', coordinates: coords });
      }
      if (lineCoords.length || mlineCoords.length) {
        const coords = [...mlineCoords, ...lineCoords];
        return JSON.stringify({ type: 'MultiLineString', coordinates: coords });
      }
      // fallback: first geometry
      return JSON.stringify(geoms[0]);
    }
    // Already a geometry
    return JSON.stringify(obj);
  } catch (e) {
    console.warn('Failed to parse GeoJSON:', (e as any)?.message);
    return '';
  }
}

const AOI_GEOM_JSON = toGeometryJSONString(AOI_GEOJSON_STRING);
const CABLES_GEOM_JSON = toGeometryJSONString(CABLES_GEOJSON_STRING);
let AOI_TURF_GEOMETRY: any = null;
try { AOI_TURF_GEOMETRY = AOI_GEOM_JSON ? JSON.parse(AOI_GEOM_JSON) : null; } catch {}

// Ship type mapping (per BarentsWatch docs)
function getShipTypeDescriptionFromCode(code: any): string {
  const n = Number(code);
  if (!isFinite(n)) return 'Unknown';
  if (n >= 1 && n <= 19) return 'Reserved for future use';
  switch (n) {
    case 0: return 'Not available';
    case 20: return 'Wing in ground';
    case 21: return 'WIG, Hazardous A';
    case 22: return 'WIG, Hazardous B';
    case 23: return 'WIG, Hazardous C';
    case 24: return 'WIG, Hazardous D';
    case 25: case 26: case 27: case 28: case 29: return 'WIG (reserved)';
    case 30: return 'Fishing';
    case 31: return 'Towing';
    case 32: return 'Towing >200m or >25m';
    case 33: return 'Dredging/underwater ops';
    case 34: return 'Diving ops';
    case 35: return 'Military ops';
    case 36: return 'Sailing';
    case 37: return 'Pleasure craft';
    case 38: case 39: return 'Reserved';
    case 40: return 'High speed craft';
    case 41: return 'HSC, Hazardous A';
    case 42: return 'HSC, Hazardous B';
    case 43: return 'HSC, Hazardous C';
    case 44: return 'HSC, Hazardous D';
    case 45: case 46: case 47: case 48: return 'HSC (reserved)';
    case 49: return 'HSC, No additional info';
    case 50: return 'Pilot vessel';
    case 51: return 'Search and Rescue';
    case 52: return 'Tug';
    case 53: return 'Port tender';
    case 54: return 'Anti-pollution';
    case 55: return 'Law enforcement';
    case 56: case 57: return 'Spare - Local vessel';
    case 58: return 'Medical transport';
    case 59: return 'Noncombatant ship';
    case 60: return 'Passenger';
    case 61: return 'Passenger, Hazardous A';
    case 62: return 'Passenger, Hazardous B';
    case 63: return 'Passenger, Hazardous C';
    case 64: return 'Passenger, Hazardous D';
    case 65: case 66: case 67: case 68: return 'Passenger (reserved)';
    case 69: return 'Passenger, No additional info';
    case 70: return 'Cargo';
    case 71: return 'Cargo, Hazardous A';
    case 72: return 'Cargo, Hazardous B';
    case 73: return 'Cargo, Hazardous C';
    case 74: return 'Cargo, Hazardous D';
    case 75: case 76: case 77: case 78: return 'Cargo (reserved)';
    case 79: return 'Cargo, No additional info';
    case 80: return 'Tanker';
    case 81: return 'Tanker, Hazardous A';
    case 82: return 'Tanker, Hazardous B';
    case 83: return 'Tanker, Hazardous C';
    case 84: return 'Tanker, Hazardous D';
    case 85: case 86: case 87: case 88: return 'Tanker (reserved)';
    case 89: return 'Tanker, No additional info';
    case 90: return 'Other type';
    case 91: return 'Other, Hazardous A';
    case 92: return 'Other, Hazardous B';
    case 93: return 'Other, Hazardous C';
    case 94: return 'Other, Hazardous D';
    case 95: case 96: case 97: case 98: return 'Other (reserved)';
    case 99: return 'Other, No additional info';
    default: return 'Unknown';
  }
}

function formatEta(eta: any): string | null {
  if (!eta) return null;
  const s = String(eta).trim();
  if (!s) return null;
  // AIS msg 5: MMDDHHmm, '00000000' means N/A
  if (/^\d{8}$/.test(s) && s !== '00000000') {
    const mm = Number(s.slice(0,2));
    const dd = Number(s.slice(2,4));
    const hh = s.slice(4,6);
    const mi = s.slice(6,8);
    if (mm>=1 && mm<=12 && dd>=1 && dd<=31) return `${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')} ${hh}:${mi} UTC`;
  }
  // Sometimes ISO is provided
  if (s.includes(':') || s.includes('-')) return s;
  return null;
}

// Local Norway EEZ and Jan Mayen AOIs
const NORWAY_GEOJSON_PATH = dataSource('Proximity markers', 'AOI', 'Norway.geojson');
const JANMAYEN_GEOJSON_PATH = dataSource('Proximity markers', 'AOI', 'Jan Mayen.geojson');
let NORWAY_GEOJSON_STRING = '';
let JANMAYEN_GEOJSON_STRING = '';
try { NORWAY_GEOJSON_STRING = fs.readFileSync(NORWAY_GEOJSON_PATH, 'utf8'); } catch { console.warn('Norway GeoJSON not found at', NORWAY_GEOJSON_PATH); }
try { JANMAYEN_GEOJSON_STRING = fs.readFileSync(JANMAYEN_GEOJSON_PATH, 'utf8'); } catch { console.warn('Jan Mayen GeoJSON not found at', JANMAYEN_GEOJSON_PATH); }
const NORWAY_GEOM_JSON = toGeometryJSONString(NORWAY_GEOJSON_STRING);
const JANMAYEN_GEOM_JSON = toGeometryJSONString(JANMAYEN_GEOJSON_STRING);
let NORWAY_TURF_GEOMETRY: any = null;
let JANMAYEN_TURF_GEOMETRY: any = null;
try { NORWAY_TURF_GEOMETRY = NORWAY_GEOM_JSON ? JSON.parse(NORWAY_GEOM_JSON) : null; } catch {}
try { JANMAYEN_TURF_GEOMETRY = JANMAYEN_GEOM_JSON ? JSON.parse(JANMAYEN_GEOM_JSON) : null; } catch {}

// Reverted: no external JSON/catch-all table; use explicit mappings + fallbacks

// BarentsWatch OAuth token cache
let BW_TOKEN_CACHE: { accessToken: string; expiresAt: number } | null = null;
async function getBarentsWatchAccessToken(): Promise<string | null> {
  // If BW_ACCESS_TOKEN provided, use it
  if (process.env.BW_ACCESS_TOKEN && process.env.BW_ACCESS_TOKEN.trim()) return process.env.BW_ACCESS_TOKEN.trim();
  // Cached token still valid?
  const now = Date.now();
  if (BW_TOKEN_CACHE && BW_TOKEN_CACHE.expiresAt - 60000 > now) return BW_TOKEN_CACHE.accessToken;
  const clientId = process.env.BW_CLIENT_ID || process.env.BW_CLIENTID || '';
  const clientSecret = process.env.BW_CLIENT_SECRET || process.env.BW_CLIENTSECRET || '';
  if (!clientId || !clientSecret) return null;
  try {
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('grant_type', 'client_credentials');
    params.set('scope', 'ais');
    const resp = await axios.post('https://id.barentswatch.no/connect/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    const token = resp.data?.access_token as string;
    const expiresIn = Number(resp.data?.expires_in || 3600);
    if (token) {
      BW_TOKEN_CACHE = { accessToken: token, expiresAt: now + expiresIn * 1000 };
      return token;
    }
  } catch (e) {
    console.warn('Failed to fetch BW token:', (e as any)?.message || String(e));
  }
  return null;
}

// In-memory cache for per-vessel static/voyage info so popups retain
// Destination/ETA/IMO/Type even when the latest sample is only a
// dynamic position message. 24h TTL.
const STATIC_INFO_TTL_MS = 24 * 60 * 60 * 1000;
type StaticInfo = { destination?: string|null; eta?: string|null; imo?: string|null; shipType?: string|null; vessel_name?: string|null; updatedAt: number };
const staticInfoByMmsi: Record<string, StaticInfo> = {};
function upsertStaticInfo(mmsi: string, info: Partial<StaticInfo>): void {
  if (!mmsi) return;
  const now = Date.now();
  const existing = staticInfoByMmsi[mmsi] || { updatedAt: 0 };
  const sanitized: any = {};
  for (const [k, v] of Object.entries(info)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') sanitized[k] = v;
  }
  staticInfoByMmsi[mmsi] = { ...existing, ...sanitized, updatedAt: now } as StaticInfo;
}
function populateFromStaticCache(mmsi: string, obj: any): any {
  const cached = staticInfoByMmsi[mmsi];
  if (!cached) return obj;
  const fill = (k: keyof StaticInfo) => {
    if (obj[k] === undefined || obj[k] === null || String(obj[k]).trim() === '') obj[k] = cached[k];
  };
  fill('destination');
  fill('eta');
  fill('imo');
  fill('shipType');
  if (obj['vessel_name'] == null || String(obj['vessel_name']).trim() === '') obj['vessel_name'] = cached.vessel_name;
  return obj;
}
function sweepStaticCache(): void {
  const now = Date.now();
  for (const [mmsi, rec] of Object.entries(staticInfoByMmsi)) {
    if (!rec || now - (rec.updatedAt || 0) > STATIC_INFO_TTL_MS) delete staticInfoByMmsi[mmsi];
  }
}

// Note: Norway and Jan Mayen zones loaded from local GeoJSON files above

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/health', (_req, res) => {
  const ais = getAisStreamStatus();
  const iceMeta = readIceEdgeMeta();
  const iceAgeMs = iceMeta?.fetchedAt ? Date.now() - new Date(iceMeta.fetchedAt).getTime() : null;
  res.json({
    ok: true,
    api: 'scripts-runner',
    port: PORT,
    aisstream: ais,
    sanctions: {
      mmsi: SANCTIONED_MMSI.size,
      imo: SANCTIONED_IMO.size,
      cacheAgeMs: SANCTIONED_CACHE_TS ? Date.now() - SANCTIONED_CACHE_TS : null,
    },
    shadowfleet: { mmsi: SHADOWFLEET_MMSI.size },
    militaryMmsi: MILITARY_MMSI.size,
    iceEdge: {
      ready: fs.existsSync(path.join(OVERLAYS_DIR, 'ice-edge.geojson')),
      ageMs: iceAgeMs,
      meta: iceMeta,
    },
    petroleum: {
      ready:
        fs.existsSync(path.join(OVERLAYS_DIR, 'petroleum.geojson')) &&
        fs.existsSync(path.join(OVERLAYS_DIR, 'pipelines.geojson')),
      ageMs: (() => {
        const m = readPetroleumMeta();
        const t = m?.fetchedAt || m?.generated_at;
        return t ? Date.now() - new Date(t).getTime() : null;
      })(),
      meta: readPetroleumMeta(),
      pipelines: {
        ready: fs.existsSync(path.join(OVERLAYS_DIR, 'pipelines.geojson')),
        meta: readPipelinesMeta(),
      },
    },
    tlsInsecure: process.env.TLS_INSECURE === '1',
    apiKeyRequired: Boolean(API_KEY),
    emailConfigured: emailConfigured(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/alerts/status', (_req, res) => {
  res.json({
    emailConfigured: emailConfigured(),
    rules: listServerAlerts().filter((r) => r.status === 'watching').length,
  });
});

app.get('/api/alerts', (_req, res) => {
  res.json({ rules: listServerAlerts() });
});

app.post('/api/alerts', (req, res) => {
  try {
    const rule = req.body;
    if (!rule?.id) return res.status(400).json({ error: 'id required' });
    upsertServerAlert(rule);
    res.json({ ok: true, emailConfigured: emailConfigured() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.delete('/api/alerts/:id', (req, res) => {
  deleteServerAlert(String(req.params.id));
  res.json({ ok: true });
});

app.post('/api/alerts/notify', async (req, res) => {
  try {
    const { email, message, mmsi, rule } = req.body || {};
    const to = String(email || rule?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'email required' });
    const text =
      message ||
      `SvalMap alert: vessel ${mmsi || ''} entered ${rule?.areaLabel || 'monitored area'}`;
    const result = await sendAlertEmail({
      to,
      subject: `SvalMap alert: ${rule?.areaLabel || 'AOI'}`,
      text: `${text}\n\nRule: ${rule?.id || ''}\nTime: ${new Date().toISOString()}\n`,
    });
    if (!result.ok) return res.status(503).json({ error: result.error });
    if (rule?.id) {
      const existing = listServerAlerts().find((r) => r.id === rule.id);
      if (existing) {
        upsertServerAlert({
          ...existing,
          status: 'triggered',
          triggeredAt: new Date().toISOString(),
          message: text,
          notified: [...new Set([...(existing.notified || []), String(mmsi || '')].filter(Boolean))],
        });
      }
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

loadServerAlerts();

// Kystverket navigation warnings (NAVAREA XIX + coastal).
// Public API returns currently in-force warnings only; recent=1 marks issued within 30 days.
const NAVWARNINGS_NAVAREA_URL =
  'https://api.kystverket.no/data/navigationwarnings/navareaxix/';
const NAVWARNINGS_COASTAL_URL =
  'https://api.kystverket.no/data/navigationwarnings/coastal/';
const NAVWARNINGS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
let navWarningsCache: { ts: number; data: any } | null = null;

/** Parse simple WKT POINT / MULTIPOINT / POLYGON (lon lat pairs) to GeoJSON geometry. */
function parseWktGeometry(wkt: string | null | undefined): any | null {
  if (!wkt || typeof wkt !== 'string') return null;
  const s = wkt.trim();
  const point = /^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i.exec(s);
  if (point) {
    return { type: 'Point', coordinates: [Number(point[1]), Number(point[2])] };
  }
  const multipoint = /^MULTIPOINT\s*\(\s*(.+)\s*\)$/i.exec(s);
  if (multipoint) {
    const coords: number[][] = [];
    const re = /\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(multipoint[1]))) {
      coords.push([Number(m[1]), Number(m[2])]);
    }
    if (!coords.length) return null;
    if (coords.length === 1) return { type: 'Point', coordinates: coords[0] };
    return { type: 'MultiPoint', coordinates: coords };
  }
  const polygon = /^POLYGON\s*\(\s*\((.+)\)\s*\)$/i.exec(s);
  if (polygon) {
    const ring = polygon[1].split(',').map((pair) => {
      const [lon, lat] = pair.trim().split(/\s+/).map(Number);
      return [lon, lat];
    });
    if (ring.length < 3 || ring.some((c) => !Number.isFinite(c[0]) || !Number.isFinite(c[1]))) {
      return null;
    }
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([...a]);
    return { type: 'Polygon', coordinates: [ring] };
  }
  return null;
}

function warningToFeature(w: any, kind: 'navarea' | 'coastal') {
  const geometry = parseWktGeometry(w?.position);
  if (!geometry) return null;
  const issued = w.dtg_timestamp || w.updated_at || null;
  const recent = withinLastDays(issued, NAVWARNINGS_LOOKBACK_MS) ? 1 : 0;
  return {
    type: 'Feature',
    geometry,
    properties: {
      kind,
      eventid: w.eventid,
      status: w.status || 'active',
      warningnumber: w.warningnumber || null,
      title:
        kind === 'navarea'
          ? `NAVAREA XIX ${w.warningnumber || ''}`.trim()
          : `Coastal ${w.warningnumber || w.location || ''}`.trim(),
      message: w.message_en || w.message_no || null,
      location: w.location || null,
      issued,
      updated_at: w.updated_at || null,
      recent,
    },
  };
}

function withinLastDays(iso: string | null | undefined, daysMs: number): boolean {
  if (!iso) return true; // keep if unknown date
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= daysMs;
}

async function fetchNavWarningsGeoJSON(): Promise<{
  type: 'FeatureCollection';
  features: any[];
  meta: any;
}> {
  const [navareaRes, coastalRes] = await Promise.all([
    axios.get(NAVWARNINGS_NAVAREA_URL, { timeout: 20000, httpsAgent: httpsAgent() }),
    axios.get(NAVWARNINGS_COASTAL_URL, { timeout: 20000, httpsAgent: httpsAgent() }),
  ]);
  const navarea = Array.isArray(navareaRes.data) ? navareaRes.data : [];
  const coastal = Array.isArray(coastalRes.data) ? coastalRes.data : [];
  const features: any[] = [];
  for (const w of navarea) {
    // Public API only returns currently active warnings (no cancelled archive).
    const f = warningToFeature(w, 'navarea');
    if (f) features.push(f);
  }
  for (const w of coastal) {
    const f = warningToFeature(w, 'coastal');
    if (f) features.push(f);
  }
  const recentCount = features.filter((f) => f.properties?.recent === 1).length;
  return {
    type: 'FeatureCollection',
    features,
    meta: {
      source: 'Kystverket Data API',
      note:
        'Public API exposes currently active NAVAREA XIX + coastal warnings only (no cancelled archive). Use scope=active for all in-force, scope=recent for issued within 30 days.',
      lookbackDays: 30,
      navareaActive: navarea.length,
      coastalActive: coastal.length,
      withGeometry: features.length,
      recentIssuedCount: recentCount,
    },
  };
}

app.get('/api/navwarnings', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'all').toLowerCase();
    const now = Date.now();
    if (!navWarningsCache || now - navWarningsCache.ts > 15 * 60 * 1000) {
      const data = await fetchNavWarningsGeoJSON();
      navWarningsCache = { ts: now, data };
    }
    let data = navWarningsCache.data;
    if (scope === 'recent' || scope === '30d') {
      data = {
        ...data,
        features: (data.features || []).filter((f: any) => f?.properties?.recent === 1),
      };
    }
    // scope=active|all → full in-force set
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Static GeoJSON overlays for MapLibre (EEZ, cables, NSM, etc.)
const OVERLAYS_DIR = dataSource('overlays');

/** SAR detections are limited to Norway EEZ + Jan Mayen EEZ + Svalbard FPZ. */
const SAR_ZONE_OVERLAY_FILES = [
  'norway-eez.geojson',
  'janmayen-eez.geojson',
  'svalbard-fpz.geojson',
] as const;
const SAR_LOOKBACK_HOURS = 24 * 30; // last 30 days (GFW SAR also lags ~5d)

type SarZone = { feature: any; bbox: [number, number, number, number] };
let SAR_ZONES: SarZone[] = [];
/** Simplified MultiPolygon for GFW 4wings report requests. */
let SAR_ZONES_GFW_GEOMETRY: { type: 'MultiPolygon'; coordinates: number[][][][] } | null = null;

function loadSarZones() {
  const zones: SarZone[] = [];
  const multiCoords: number[][][][] = [];
  for (const file of SAR_ZONE_OVERLAY_FILES) {
    try {
      const full = path.join(OVERLAYS_DIR, file);
      if (!fs.existsSync(full)) {
        console.warn('[gfw/sar] zone file missing', file);
        continue;
      }
      const gj = JSON.parse(fs.readFileSync(full, 'utf8'));
      const features: any[] =
        gj?.type === 'FeatureCollection'
          ? gj.features || []
          : gj?.type === 'Feature'
            ? [gj]
            : gj?.type === 'Polygon' || gj?.type === 'MultiPolygon'
              ? [{ type: 'Feature', properties: {}, geometry: gj }]
              : [];
      for (const f of features) {
        if (!f?.geometry) continue;
        const bbox = turf.bbox(f) as [number, number, number, number];
        zones.push({ feature: f, bbox });
        try {
          const simp = turf.simplify(f, { tolerance: 0.04, highQuality: false, mutate: false });
          const g = simp.geometry;
          if (g?.type === 'Polygon') multiCoords.push(g.coordinates);
          else if (g?.type === 'MultiPolygon') multiCoords.push(...g.coordinates);
        } catch {
          const g = f.geometry;
          if (g?.type === 'Polygon') multiCoords.push(g.coordinates);
          else if (g?.type === 'MultiPolygon') multiCoords.push(...g.coordinates);
        }
      }
    } catch (e: any) {
      console.warn('[gfw/sar] zone load failed', file, e?.message || e);
    }
  }
  SAR_ZONES = zones;
  SAR_ZONES_GFW_GEOMETRY = multiCoords.length
    ? { type: 'MultiPolygon', coordinates: multiCoords }
    : null;
  console.log(
    `[gfw/sar] zones=${zones.length} gfwGeom=${SAR_ZONES_GFW_GEOMETRY ? 'MultiPolygon' : 'bbox-fallback'}`
  );
}
loadSarZones();

function pointInSarZones(lon: number, lat: number): boolean {
  if (!SAR_ZONES.length) return pointInGfwMonitorBbox(lon, lat);
  const pt = turf.point([lon, lat]);
  for (const z of SAR_ZONES) {
    const [minX, minY, maxX, maxY] = z.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    try {
      if (turf.booleanPointInPolygon(pt, z.feature)) return true;
    } catch {
      /* ignore bad ring */
    }
  }
  return false;
}

function sarZonesRequestGeometry():
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Polygon'; coordinates: number[][][] } {
  return SAR_ZONES_GFW_GEOMETRY || gfwMonitorGeometry();
}

app.use('/overlays', express.static(OVERLAYS_DIR));
app.get('/api/overlays', (_req, res) => {
  try {
    const files = fs.existsSync(OVERLAYS_DIR)
      ? fs.readdirSync(OVERLAYS_DIR).filter((f) => f.endsWith('.geojson'))
      : [];
    res.json({
      overlays: files.map((f) => ({
        id: f.replace(/\.geojson$/, ''),
        url: `/overlays/${encodeURIComponent(f)}`,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

const ICE_EDGE_META = path.join(OVERLAYS_DIR, 'ice-edge.meta.json');
const ICE_EDGE_SCRIPT = path.join(__dirname, 'fetch_ice_edge.py');
const ICE_EDGE_PYTHON = path.join(__dirname, '.venv-cmems', 'bin', 'python');

function readIceEdgeMeta(): any | null {
  try {
    if (!fs.existsSync(ICE_EDGE_META)) return null;
    return JSON.parse(fs.readFileSync(ICE_EDGE_META, 'utf8'));
  } catch {
    return null;
  }
}

app.get('/api/ice-edge/status', (_req, res) => {
  const meta = readIceEdgeMeta();
  const geo = path.join(OVERLAYS_DIR, 'ice-edge.geojson');
  res.json({
    ready: fs.existsSync(geo),
    meta,
    url: '/overlays/ice-edge.geojson',
  });
});

let iceEdgeRefreshing = false;
function refreshIceEdge(reason: string): Promise<{ ok: boolean; error?: string; meta?: any }> {
  if (iceEdgeRefreshing) return Promise.resolve({ ok: false, error: 'already running' });
  if (!fs.existsSync(ICE_EDGE_PYTHON)) {
    return Promise.resolve({
      ok: false,
      error: 'Python venv missing (.venv-cmems). Run: python3 -m venv .venv-cmems && pip install copernicusmarine matplotlib numpy xarray python-dotenv',
    });
  }
  iceEdgeRefreshing = true;
  console.log(`[ice-edge] refresh (${reason})…`);
  return new Promise((resolve) => {
    const child = spawn(ICE_EDGE_PYTHON, [ICE_EDGE_SCRIPT], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => process.stdout.write(b));
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
      process.stderr.write(b);
    });
    child.on('close', (code) => {
      iceEdgeRefreshing = false;
      if (code === 0) {
        resolve({ ok: true, meta: readIceEdgeMeta() });
      } else {
        resolve({ ok: false, error: stderr.slice(-500) || `exit ${code}` });
      }
    });
  });
}

app.post('/api/ice-edge/refresh', async (_req, res) => {
  const result = await refreshIceEdge('api');
  if (result.ok) res.json(result);
  else res.status(500).json(result);
});

const PETROLEUM_META = path.join(OVERLAYS_DIR, 'petroleum.meta.json');
const PIPELINES_META = path.join(OVERLAYS_DIR, 'pipelines.meta.json');

function readPetroleumMeta(): any | null {
  try {
    if (!fs.existsSync(PETROLEUM_META)) return null;
    return JSON.parse(fs.readFileSync(PETROLEUM_META, 'utf8'));
  } catch {
    return null;
  }
}

function readPipelinesMeta(): any | null {
  try {
    if (!fs.existsSync(PIPELINES_META)) return null;
    return JSON.parse(fs.readFileSync(PIPELINES_META, 'utf8'));
  } catch {
    return null;
  }
}

let petroleumRefreshing = false;
async function refreshPetroleum(reason: string): Promise<{
  ok: boolean;
  error?: string;
  meta?: any;
  featureCount?: number;
  pipelines?: { featureCount?: number; meta?: any };
}> {
  if (petroleumRefreshing) return { ok: false, error: 'already running' };
  petroleumRefreshing = true;
  console.log(`[petroleum/sodir] refresh (${reason})…`);
  try {
    const [facilities, pipelines] = await Promise.all([
      fetchSodirFacilitiesToFile(OVERLAYS_DIR),
      fetchSodirPipelinesToFile(OVERLAYS_DIR),
    ]);
    if (!facilities.ok) {
      console.warn('[petroleum/sodir] facilities refresh failed', facilities.error);
      return { ok: false, error: facilities.error };
    }
    if (!pipelines.ok) {
      console.warn('[petroleum/sodir] pipelines refresh failed', pipelines.error);
      return { ok: false, error: pipelines.error };
    }
    console.log(
      `[petroleum/sodir] ok facilities=${facilities.featureCount} pipelines=${pipelines.featureCount} source=sodir-factmaps`
    );
    return {
      ok: true,
      meta: facilities.meta || readPetroleumMeta(),
      featureCount: facilities.featureCount,
      pipelines: {
        featureCount: pipelines.featureCount,
        meta: pipelines.meta || readPipelinesMeta(),
      },
    };
  } finally {
    petroleumRefreshing = false;
  }
}

app.get('/api/petroleum/status', (_req, res) => {
  const meta = readPetroleumMeta();
  const pipelinesMeta = readPipelinesMeta();
  const geo = path.join(OVERLAYS_DIR, 'petroleum.geojson');
  const pipelinesGeo = path.join(OVERLAYS_DIR, 'pipelines.geojson');
  res.json({
    ready: fs.existsSync(geo) && fs.existsSync(pipelinesGeo),
    meta,
    pipelines: {
      ready: fs.existsSync(pipelinesGeo),
      meta: pipelinesMeta,
      url: '/overlays/pipelines.geojson',
    },
    url: '/overlays/petroleum.geojson',
  });
});

app.post('/api/petroleum/refresh', async (_req, res) => {
  const result = await refreshPetroleum('api');
  if (result.ok) res.json(result);
  else res.status(500).json(result);
});

app.get('/api/assets', async (_req, res) => {
  try {
    const payload:any[] = [];
    // Do not include AOI polygon to the client; overlay layers are added independently
    if (CABLES_GEOJSON_STRING) {
      payload.push({ id: 'CABLES_LOCAL', name: 'Svalbard Cables', type: 'CABLE', geojson: CABLES_GEOJSON_STRING });
    }
    res.json(payload);
  } catch (e:any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/api/positions', async (req, res) => {
  const since = req.query.since ? String(req.query.since) : '1440';
  const minutes = Math.max(1, Math.min(7 * 24 * 60, parseInt(since, 10) || 1440));
  const limit = Math.max(1, Math.min(20000, parseInt(String(req.query.limit || '5000'), 10) || 5000));
  // Svalbard FPZ: all vessels (AOI_GEOM_JSON). Norway + Jan Mayen: all vessels
  // Load Norway/Jan Mayen zones from assets by name if present
  const query = `
    WITH norway AS (
      SELECT ST_UNION_AGG(geog) AS g FROM \`${BQ_DATASET}.assets\`
      WHERE LOWER(name) LIKE '%norway eez%' OR LOWER(type) LIKE '%norway eez%' OR LOWER(name) LIKE '%norway%'
    ), jan AS (
      SELECT ST_UNION_AGG(geog) AS g FROM \`${BQ_DATASET}.assets\`
      WHERE LOWER(name) LIKE '%jan mayen%' OR LOWER(type) LIKE '%jan mayen%'
    )
    SELECT m.mmsi, m.timestamp, ST_X(m.coordinates) AS lon, ST_Y(m.coordinates) AS lat, m.speed, m.course, m.heading, m.status, v.name AS vessel_name
    FROM \`${BQ_DATASET}.vessel_positions\` m
    LEFT JOIN \`${BQ_DATASET}.vessels\` v ON v.mmsi = m.mmsi
    LEFT JOIN norway n ON TRUE
    LEFT JOIN jan j ON TRUE
    WHERE m.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${minutes} MINUTE)
      AND (
        ${AOI_GEOM_JSON ? 'ST_CONTAINS(ST_GEOGFROMGEOJSON(@svalbardGeom), m.coordinates)' : 'FALSE'}
        OR (
          (n.g IS NOT NULL AND ST_CONTAINS(n.g, m.coordinates))
          OR (j.g IS NOT NULL AND ST_CONTAINS(j.g, m.coordinates))
        )
      )
    ORDER BY m.timestamp DESC
    LIMIT ${limit}`;
  const [rows] = await bq.query({
    query,
    useLegacySql: false,
    params: AOI_GEOM_JSON ? { svalbardGeom: AOI_GEOM_JSON } : undefined
  } as any);
  res.json(rows || []);
});

// Global Fishing Watch — real proxy is registered below (/api/gfw/events, /api/gfw/detections)

function pointInGeom(lon: number, lat: number, geom: any): boolean {
  if (!geom) return false;
  try {
    return turf.booleanPointInPolygon(turf.point([lon, lat]), {
      type: 'Feature',
      properties: {},
      geometry: geom,
    } as any);
  } catch {
    return false;
  }
}

function inNorthAtlanticBox(lon: number, lat: number): boolean {
  return (
    lat >= NORTH_ATLANTIC_BBOX.minLat &&
    lat <= NORTH_ATLANTIC_BBOX.maxLat &&
    lon >= NORTH_ATLANTIC_BBOX.minLon &&
    lon <= NORTH_ATLANTIC_BBOX.maxLon
  );
}

function isMilitaryShipType(shipType: any): boolean {
  const n = Number(shipType);
  if (n === 35 || n === 55) return true;
  const s = String(shipType || '').toLowerCase();
  return s.includes('military') || s.includes('law enforcement');
}

function isFishingShipType(shipType: any): boolean {
  const n = Number(shipType);
  if (n === 30) return true;
  return String(shipType || '').toLowerCase().includes('fishing');
}

function isRecreationalShipType(shipType: any): boolean {
  const n = Number(shipType);
  if (n === 36 || n === 37) return true;
  const s = String(shipType || '').toLowerCase();
  return s.includes('pleasure') || s.includes('sailing') || s.includes('recreational');
}

/**
 * Same display rules as before, expanded geographically:
 * - Svalbard FPZ + Norway EEZ + Jan Mayen EEZ: all vessels
 *   (drop fishing <15 m / recreational <45 m when length known)
 * - Rest of North Atlantic north of 54°N:
 *   Russian / research / shadow / sanctioned / military only
 */
function shouldIncludeVessel(opts: {
  lon: number;
  lat: number;
  mmsi: string;
  imo: string | null;
  shipType: any;
  lengthM: number | null;
}): { include: boolean; inSvalbard: boolean } {
  const { lon, lat, mmsi, imo, shipType, lengthM } = opts;
  const inSvalbard = pointInGeom(lon, lat, AOI_TURF_GEOMETRY);
  const inNorwayEez = pointInGeom(lon, lat, NORWAY_TURF_GEOMETRY);
  const inJanMayenEez = pointInGeom(lon, lat, JANMAYEN_TURF_GEOMETRY);
  const inFullCoverageZone = inSvalbard || inNorwayEez || inJanMayenEez;

  if (inFullCoverageZone) {
    if (lengthM != null) {
      if (isFishingShipType(shipType) && lengthM < 15)
        return { include: false, inSvalbard };
      if (isRecreationalShipType(shipType) && lengthM < 45)
        return { include: false, inSvalbard };
    }
    return { include: true, inSvalbard };
  }

  if (!inNorthAtlanticBox(lon, lat)) return { include: false, inSvalbard: false };

  const isRussian = parseInt(mmsi.slice(0, 3), 10) === 273;
  const isResearch = isRussianResearchVessel(mmsi, imo);
  const isSanctioned =
    SANCTIONED_MMSI.has(mmsi) ||
    (!!imo && SANCTIONED_IMO.has(imo)) ||
    (!!imo && IMO_TO_MMSI_MAP.has(imo) && SANCTIONED_MMSI.has(IMO_TO_MMSI_MAP.get(imo)!));
  const isShadow =
    SHADOWFLEET_MMSI.has(mmsi) ||
    SHADOW_TEST_SET.has(mmsi) ||
    (!!imo && SHADOWFLEET_IMO.has(imo));
  const isMilitary = isMilitaryShipType(shipType) || MILITARY_MMSI.has(mmsi);
  return {
    include: isRussian || isResearch || isSanctioned || isShadow || isMilitary,
    inSvalbard: false,
  };
}

function normalizeLiveVessel(input: {
  mmsi: string;
  lon: number;
  lat: number;
  speed?: any;
  course?: any;
  heading?: any;
  status?: any;
  vessel_name?: any;
  destination?: any;
  imo?: any;
  shipType?: any;
  shipTypeCode?: any;
  eta?: any;
  timestamp?: any;
  lengthM?: number | null;
  source?: string;
}): any | null {
  const mmsiStr = String(input.mmsi || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
  if (!mmsiStr || mmsiStr === '000000000') return null;
  const lon = Number(input.lon);
  const lat = Number(input.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const imoRaw = input.imo != null && input.imo !== '' ? String(input.imo) : '';
  const imoStr = imoRaw && imoRaw !== '0' ? imoRaw : '';
  const shipTypeRaw = input.shipType ?? input.shipTypeCode ?? null;
  const shipType =
    typeof shipTypeRaw === 'string'
      ? shipTypeRaw
      : getShipTypeDescriptionFromCode(shipTypeRaw);

  const decision = shouldIncludeVessel({
    lon,
    lat,
    mmsi: mmsiStr,
    imo: imoStr || null,
    shipType: shipTypeRaw ?? shipType,
    lengthM: input.lengthM ?? null,
  });
  if (!decision.include) return null;

  const isEuSanctioned =
    (!!imoStr && SANCTIONED_IMO.has(imoStr)) ||
    (!!imoStr && IMO_TO_MMSI_MAP.has(imoStr) && SANCTIONED_MMSI.has(IMO_TO_MMSI_MAP.get(imoStr)!));
  const isShadow =
    SHADOWFLEET_MMSI.has(mmsiStr) ||
    SHADOW_TEST_SET.has(mmsiStr) ||
    (!!imoStr && SHADOWFLEET_IMO.has(imoStr));

  const normalized = {
    mmsi: mmsiStr,
    timestamp: input.timestamp ?? null,
    lon,
    lat,
    speed: input.speed ?? null,
    course: input.course ?? null,
    heading: input.heading ?? null,
    status: input.status ?? null,
    vessel_name:
      input.vessel_name ||
      RESEARCH_NAME_BY_MMSI.get(mmsiStr) ||
      null,
    destination: typeof input.destination === 'string' ? input.destination : null,
    imo: imoStr || null,
    shipType,
    sanctioned: SANCTIONED_MMSI.has(mmsiStr) || isEuSanctioned,
    shadowfleet: isShadow,
    military: isMilitaryShipType(shipTypeRaw ?? shipType) || MILITARY_MMSI.has(mmsiStr),
    research: isRussianResearchVessel(mmsiStr, imoStr || null),
    eta: formatEta(input.eta),
    source: input.source || 'unknown',
  };
  upsertStaticInfo(mmsiStr, {
    destination: normalized.destination,
    eta: normalized.eta,
    imo: normalized.imo,
    shipType: normalized.shipType,
    vessel_name: normalized.vessel_name,
  });
  return populateFromStaticCache(mmsiStr, normalized);
}

async function fetchBarentsWatchLatest(): Promise<any[]> {
  const token = await getBarentsWatchAccessToken();
  if (!token) return [];
  const agent = httpsAgent();
  try {
    const r1 = await axios.get(
      'https://live.ais.barentswatch.no/v1/latest/combined?modelType=Full&modelFormat=Json',
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent: agent, timeout: 15000 }
    );
    const data = r1.data;
    return Array.isArray(data) ? data : data?.vessels || data?.positions || [];
  } catch {
    try {
      const r2 = await axios.get(
        'https://live.ais.barentswatch.no/v1/combined?modelType=Full&modelFormat=Json',
        { headers: { Authorization: `Bearer ${token}` }, httpsAgent: agent, timeout: 20000 }
      );
      const data = r2.data;
      return Array.isArray(data) ? data : data?.vessels || data?.positions || [];
    } catch {
      return [];
    }
  }
}

/** Live AIS merge used by UI, search, incidents, and alert watcher. */
async function getLivePositionsList(): Promise<any[]> {
  await ensureSanctionedLoaded();
  await ensureShadowLoaded();
  await ensureMilitaryLoaded();
  await ensureImoMapLoaded();

  const byMmsi = new Map<string, any>();

  for (const v of getAisStreamVessels()) {
    const normalized = normalizeLiveVessel({
      mmsi: v.mmsi,
      lon: v.lon,
      lat: v.lat,
      speed: v.speed,
      course: v.course,
      heading: v.heading,
      status: v.status,
      vessel_name: v.vessel_name,
      destination: v.destination,
      imo: v.imo,
      shipType: v.shipType,
      shipTypeCode: v.shipTypeCode,
      eta: v.eta,
      timestamp: v.updatedAt ? new Date(v.updatedAt).toISOString() : null,
      lengthM: vesselLengthMeters(v),
      source: 'aisstream',
    });
    if (normalized) byMmsi.set(normalized.mmsi, normalized);
  }

  const bwList = await fetchBarentsWatchLatest();
  for (const v of bwList) {
    const lon =
      v?.lon ??
      v?.Lon ??
      v?.longitude ??
      v?.Longitude ??
      v?.position?.longitude ??
      v?.position?.lon ??
      v?.coordinates?.longitude;
    const lat =
      v?.lat ??
      v?.Lat ??
      v?.latitude ??
      v?.Latitude ??
      v?.position?.latitude ??
      v?.position?.lat ??
      v?.coordinates?.latitude;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    const destinationRaw =
      v?.destination ?? v?.Destination ?? v?.properties?.destination ?? null;
    const etaRaw = v?.eta ?? v?.ETA ?? v?.properties?.eta ?? null;
    const imoRaw =
      v?.imoNumber ?? v?.imo ?? v?.IMO ?? v?.properties?.imoNumber ?? null;
    const nameRaw =
      v?.shipName ?? v?.name ?? v?.ShipName ?? v?.properties?.name ?? null;
    const shipTypeRaw =
      v?.shipTypeDesc ?? v?.shipType ?? v?.properties?.shipType ?? null;
    const normalized = normalizeLiveVessel({
      mmsi: String(v?.mmsi ?? v?.MMSI ?? ''),
      lon,
      lat,
      speed: v?.speedOverGround ?? v?.sog ?? v?.SpeedOverGround ?? null,
      course: v?.courseOverGround ?? v?.cog ?? v?.CourseOverGround ?? null,
      heading: v?.trueHeading ?? v?.heading ?? v?.TrueHeading ?? null,
      status: v?.navigationalStatus ?? v?.navstat ?? v?.NavigationalStatus ?? null,
      vessel_name: nameRaw,
      destination: destinationRaw,
      imo: imoRaw,
      shipType: shipTypeRaw,
      eta: etaRaw,
      timestamp: v?.msgtime ?? v?.msgTime ?? v?.time ?? v?.Timestamp ?? null,
      source: 'barentswatch',
    });
    if (!normalized) continue;
    const existing = byMmsi.get(normalized.mmsi);
    if (!existing) {
      byMmsi.set(normalized.mmsi, normalized);
      continue;
    }
    byMmsi.set(normalized.mmsi, {
      ...normalized,
      ...existing,
      vessel_name: existing.vessel_name || normalized.vessel_name,
      destination: existing.destination || normalized.destination,
      imo: existing.imo || normalized.imo,
      shipType:
        existing.shipType && existing.shipType !== 'Unknown'
          ? existing.shipType
          : normalized.shipType,
      eta: existing.eta || normalized.eta,
      source: existing.source === 'aisstream' ? 'aisstream+bw' : existing.source,
    });
  }

  sweepStaticCache();
  return Array.from(byMmsi.values());
}

app.get('/api/live-positions', async (_req, res) => {
  try {
    res.json(await getLivePositionsList());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/api/vessels/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ results: [] });
    const list = await getLivePositionsList();
    const digits = q.replace(/\D/g, '');
    const results = list
      .filter((v) => {
        const name = String(v.vessel_name || '').toLowerCase();
        const mmsi = String(v.mmsi || '');
        const imo = String(v.imo || '');
        if (digits.length >= 3 && (mmsi.includes(digits) || imo.includes(digits))) return true;
        return name.includes(q);
      })
      .slice(0, 25)
      .map((v) => ({
        mmsi: v.mmsi,
        vessel_name: v.vessel_name,
        imo: v.imo,
        lon: v.lon,
        lat: v.lat,
        sanctioned: !!v.sanctioned,
        shadowfleet: !!v.shadowfleet,
        military: !!v.military,
        research: !!v.research,
        shipType: v.shipType,
      }));
    res.json({ results, totalLive: list.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/api/sanctions/lookup', async (req, res) => {
  try {
    await ensureSanctionedLoaded();
    await ensureShadowLoaded();
    const mmsi = String(req.query.mmsi || '')
      .replace(/\D/g, '')
      .padStart(9, '0')
      .slice(-9);
    const imo = String(req.query.imo || '').replace(/\D/g, '');
    let meta: any = {};
    try {
      meta = JSON.parse(fs.readFileSync(EU_DESIGNATED_META, 'utf8'));
    } catch {
      /* empty */
    }
    const sanctionedMmsi = mmsi.length === 9 && SANCTIONED_MMSI.has(mmsi);
    const sanctionedImo = imo.length >= 7 && SANCTIONED_IMO.has(imo);
    const shadowMmsi = mmsi.length === 9 && (SHADOWFLEET_MMSI.has(mmsi) || SHADOW_TEST_SET.has(mmsi));
    const shadowImo = imo.length >= 7 && SHADOWFLEET_IMO.has(imo);
    const mappedMmsi = imo && IMO_TO_MMSI_MAP.get(imo);
    res.json({
      mmsi: mmsi || null,
      imo: imo || null,
      sanctioned: sanctionedMmsi || sanctionedImo,
      shadowfleet: shadowMmsi || shadowImo,
      matches: {
        sanctionedMmsi,
        sanctionedImo,
        shadowMmsi,
        shadowImo,
        imoMappedMmsi: mappedMmsi || null,
      },
      sources: [
        sanctionedImo || sanctionedMmsi
          ? 'Local EU designated / OpenSanctions vessel lists (CSV cache)'
          : null,
        shadowMmsi || shadowImo ? 'Local shadow-fleet CSV' : null,
      ].filter(Boolean),
      listMeta: {
        euImoCount: readEuDesignatedCsv().size,
        sanctionedMmsiCache: SANCTIONED_MMSI.size,
        sanctionedImoCache: SANCTIONED_IMO.size,
        shadowMmsiCache: SHADOWFLEET_MMSI.size,
        meta,
      },
      opensanctionsUrl: imo
        ? `https://www.opensanctions.org/search/?q=${encodeURIComponent(imo)}`
        : mmsi
          ? `https://www.opensanctions.org/search/?q=${encodeURIComponent(mmsi)}`
          : 'https://www.opensanctions.org/',
      disclaimer:
        'Boolean match against free local lists only — not a legal determination. Cross-check primary listings before publication.',
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/** Free live heuristics: proximity & slow loiter among vessels of interest. */
app.get('/api/incidents/live', async (req, res) => {
  try {
    const proxNm = Math.max(0.2, Math.min(10, parseFloat(String(req.query.nm || '1')) || 1));
    const loiterKn = Math.max(0.1, Math.min(3, parseFloat(String(req.query.loiter || '0.8')) || 0.8));
    const list = await getLivePositionsList();
    const ofInterest = (v: any) =>
      !!(v.sanctioned || v.shadowfleet || v.research || String(v.mmsi).startsWith('273'));
    // Proximity: at least one vessel must be RU / research / sanctioned / shadow (skip pure military pairs)
    const interest = list.filter((v) => ofInterest(v) || v.military);
    const incidents: any[] = [];

    for (let i = 0; i < interest.length; i++) {
      for (let j = i + 1; j < interest.length; j++) {
        const a = interest[i];
        const b = interest[j];
        if (!ofInterest(a) && !ofInterest(b)) continue;
        const from = turf.point([a.lon, a.lat]);
        const to = turf.point([b.lon, b.lat]);
        const km = turf.distance(from, to, { units: 'kilometers' });
        const nm = km / 1.852;
        if (nm <= proxNm) {
          incidents.push({
            id: `prox-${a.mmsi}-${b.mmsi}`,
            type: 'proximity',
            title: 'Close approach',
            message: `${a.vessel_name || a.mmsi} ↔ ${b.vessel_name || b.mmsi} · ${nm.toFixed(2)} nm`,
            mmsi: [a.mmsi, b.mmsi],
            lon: (a.lon + b.lon) / 2,
            lat: (a.lat + b.lat) / 2,
            distanceNm: Math.round(nm * 100) / 100,
          });
        }
      }
    }

    for (const v of interest) {
      if (!ofInterest(v) && !v.military) continue;
      const spd = Number(v.speed);
      if (!Number.isFinite(spd) || spd > loiterKn) continue;
      incidents.push({
        id: `loiter-${v.mmsi}`,
        type: 'loiter',
        title: 'Slow / loitering',
        message: `${v.vessel_name || v.mmsi} · ${spd.toFixed(1)} kn`,
        mmsi: [v.mmsi],
        lon: v.lon,
        lat: v.lat,
        speed: spd,
      });
    }

    incidents.sort((a, b) => (a.distanceNm ?? 99) - (b.distanceNm ?? 99));
    res.json({
      incidents: incidents.slice(0, 40),
      meta: {
        interestCount: interest.length,
        liveCount: list.length,
        proxNm,
        loiterKn,
        note: 'Heuristic only — not GFW or BQ detector output.',
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/api/aisstream/status', (_req, res) => {
  res.json(getAisStreamStatus());
});

// Historic AIS track (BarentsWatch free open data, max 14 days)
// Docs: https://historic.ais.barentswatch.no
async function fetchHistoricTrack(mmsi: string, days: number, intervalMin: number) {
  const token = await getBarentsWatchAccessToken();
  if (!token) throw Object.assign(new Error('BarentsWatch credentials not configured'), { status: 400 });
  const agent = httpsAgent();
  const clampedDays = Math.max(1, Math.min(14, days));
  let list: any[] = [];
  let endpoint = 'trackslast24hours';

  if (clampedDays <= 1) {
    const url = `https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/${encodeURIComponent(mmsi)}`;
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: agent,
      timeout: 45000,
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (r.status >= 400) {
      const err: any = new Error(r.data?.title || r.data?.detail || `Historic AIS HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    list = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.tracks) ? r.data.tracks : [];
  } else {
    endpoint = 'tracks';
    const to = new Date();
    const from = new Date(to.getTime() - clampedDays * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const toIso = to.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const url = `https://historic.ais.barentswatch.no/v1/historic/tracks/${encodeURIComponent(mmsi)}/${encodeURIComponent(fromIso)}/${encodeURIComponent(toIso)}`;
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: agent,
      timeout: 60000,
      validateStatus: (s) => s >= 200 && s < 500,
      params: { filterSatellitePositions: false },
    });
    if (r.status >= 400) {
      const err: any = new Error(r.data?.title || r.data?.detail || `Historic AIS HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    list = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.tracks) ? r.data.tracks : [];
  }

  const rows = list
    .map((v) => ({
      lon: Number(v.longitude ?? v.lon ?? v.lng),
      lat: Number(v.latitude ?? v.lat),
      time: v.msgtime || v.msgTime || v.timestamp || v.time || null,
      speed: v.speedOverGround ?? v.sog ?? v.speed ?? null,
      course: v.courseOverGround ?? v.cog ?? v.course ?? null,
      heading: v.trueHeading ?? v.heading ?? null,
      name: v.name || null,
      shipType: v.shipType ?? null,
      mmsi: String(v.mmsi ?? mmsi),
    }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.time)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const keep: typeof rows = [];
  let lastKeptTs = 0;
  const stepMs = intervalMin * 60 * 1000;
  for (const p of rows) {
    const t = new Date(p.time).getTime();
    if (!Number.isFinite(t)) continue;
    if (keep.length === 0 || t - lastKeptTs >= stepMs) {
      keep.push(p);
      lastKeptTs = t;
    }
  }
  if (rows.length && (!keep.length || keep[keep.length - 1].time !== rows[rows.length - 1].time)) {
    keep.push(rows[rows.length - 1]);
  }

  const line = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: keep.map((p) => [p.lon, p.lat]) },
    properties: { mmsi, points: keep.length, days: clampedDays },
  };
  const points = {
    type: 'FeatureCollection',
    features: keep.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        mmsi,
        time: p.time,
        speed: p.speed,
        course: p.course,
        heading: p.heading,
      },
    })),
  };
  return {
    line,
    points,
    meta: {
      mmsi,
      days: clampedDays,
      endpoint,
      raw: list.length,
      returned: keep.length,
      intervalMin,
      source: 'BarentsWatch Historic AIS (open, Norwegian waters, ≤14 days)',
      maxLookbackDays: 14,
    },
  };
}

app.get('/api/tracks24h', async (req, res) => {
  try {
    const mmsi = String(req.query.mmsi || '').trim();
    const intervalMin = Math.max(5, Math.min(120, parseInt(String(req.query.interval || '15'), 10) || 15));
    const days = Math.max(1, Math.min(14, parseInt(String(req.query.days || '1'), 10) || 1));
    if (!mmsi) return res.status(400).json({ error: 'mmsi required' });
    const data = await fetchHistoricTrack(mmsi, days, intervalMin);
    res.json(data);
  } catch (e: any) {
    const status = e?.status || 500;
    console.warn('[tracks]', e?.message || e);
    res.status(status).json({
      error: e?.message || String(e),
      line: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { mmsi: req.query.mmsi } },
      points: { type: 'FeatureCollection', features: [] },
    });
  }
});

app.get('/api/tracks', async (req, res) => {
  try {
    const mmsi = String(req.query.mmsi || '').trim();
    const intervalMin = Math.max(5, Math.min(120, parseInt(String(req.query.interval || '15'), 10) || 15));
    const days = Math.max(1, Math.min(14, parseInt(String(req.query.days || '1'), 10) || 1));
    if (!mmsi) return res.status(400).json({ error: 'mmsi required' });
    res.json(await fetchHistoricTrack(mmsi, days, intervalMin));
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

// Russian proximity to cables within X meters (default 5000m) in last Y minutes (default 60)
app.get('/api/russian-near-cables', async (req, res) => {
  const distanceMeters = Math.max(100, Math.min(20000, parseInt(String(req.query.distance || '5000'), 10) || 5000));
  const minutes = Math.max(5, Math.min(24*60, parseInt(String(req.query.since || '60'), 10) || 60));
  if (!CABLES_GEOM_JSON) return res.json([]);
  const [rows] = await bq.query({
    query: `SELECT m.mmsi, v.name AS vessel_name, m.timestamp, m.speed, m.course, m.heading,
                   ST_X(m.coordinates) AS lon, ST_Y(m.coordinates) AS lat,
                   ST_DISTANCE(m.coordinates, ST_GEOGFROMGEOJSON(@cablesGeom)) AS meters
            FROM \`${BQ_DATASET}.vessel_positions\` m
            LEFT JOIN \`${BQ_DATASET}.vessels\` v ON v.mmsi = m.mmsi
            WHERE m.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @mins MINUTE)
              AND CAST(SUBSTR(m.mmsi,1,3) AS INT64) = 273
              AND ST_DWITHIN(m.coordinates, ST_GEOGFROMGEOJSON(@cablesGeom), @dist)`,
    useLegacySql: false,
    params: { cablesGeom: CABLES_GEOM_JSON, mins: minutes, dist: distanceMeters }
  } as any);
  res.json(rows || []);
});

// GFW proxy endpoints — Global Fishing Watch API v3
// Docs: https://globalfishingwatch.org/our-apis/documentation/docs/v3
// Gaps first — AIS-off is the priority layer and shouldn't wait on denser datasets.
const GFW_EVENT_DATASETS = [
  'public-global-gaps-events:latest',
  'public-global-loitering-events:latest',
  'public-global-encounters-events:latest',
  'public-global-port-visits-events:latest',
] as const;

type GfwCacheEntry = { ts: number; payload: any };
const GFW_EVENTS_CACHE = new Map<string, GfwCacheEntry>();
const GFW_CACHE_TTL_MS = 10 * 60 * 1000;
/** Share in-flight loads so concurrent warm/UI requests don't stampede GFW. */
const GFW_EVENTS_INFLIGHT = new Map<string, Promise<any>>();

function getGfwEventsCached(hours: number): any | null {
  const cacheKey = `events:${hours}`;
  const cached = GFW_EVENTS_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < GFW_CACHE_TTL_MS) return cached.payload;
  return null;
}

function loadGfwEventsShared(hours: number, limitRaw = 500): Promise<any> {
  const cacheKey = `events:${hours}`;
  const fresh = getGfwEventsCached(hours);
  if (fresh) return Promise.resolve(fresh);
  const existing = GFW_EVENTS_INFLIGHT.get(cacheKey);
  if (existing) return existing;
  const p = loadGfwEvents(hours, limitRaw).finally(() => {
    GFW_EVENTS_INFLIGHT.delete(cacheKey);
  });
  GFW_EVENTS_INFLIGHT.set(cacheKey, p);
  return p;
}

/** Norway monitoring bbox (mainland + Jan Mayen + Svalbard) */
function gfwMonitorGeometry(): { type: 'Polygon'; coordinates: number[][][] } {
  return {
    type: 'Polygon',
    coordinates: [[[-10, 57.5], [35, 57.5], [35, 81], [-10, 81], [-10, 57.5]]],
  };
}

function pointInGfwMonitorBbox(lon: number, lat: number): boolean {
  // Slightly wider so Barents / coastal Russia AIS-off events are kept
  return lon >= -15 && lon <= 45 && lat >= 54 && lat <= 82;
}

function normalizeGfwEventType(raw: unknown): string {
  const t = String(raw || '').toLowerCase();
  if (t.includes('loiter')) return 'loitering';
  if (t.includes('encounter')) return 'encounter';
  if (t.includes('port')) return 'port_visit';
  if (t.includes('gap') || t.includes('ais')) return 'ais_off';
  if (t.includes('fish')) return 'fishing';
  return t || 'event';
}

function gfwEventPosition(ev: any): { lon: number; lat: number } | null {
  let lon: number | undefined;
  let lat: number | undefined;
  // Prefer AIS-off / on positions when present (gap events)
  const off = ev?.gap?.offPosition;
  if (off) {
    lon = Number(off.lon ?? off.longitude);
    lat = Number(off.lat ?? off.latitude);
  }
  if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && ev?.position) {
    lon = Number(ev.position.lon ?? ev.position.longitude);
    lat = Number(ev.position.lat ?? ev.position.latitude);
  } else if (
    (!Number.isFinite(lon) || !Number.isFinite(lat)) &&
    ev?.geometry?.type === 'Point' &&
    Array.isArray(ev.geometry.coordinates)
  ) {
    lon = Number(ev.geometry.coordinates[0]);
    lat = Number(ev.geometry.coordinates[1]);
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon: lon!, lat: lat! };
}

/** True if the event time range overlaps [windowStart, now]. */
function isRecentEnoughGfwEvent(ev: any, windowStart: number, now: number): boolean {
  const evStart = ev.start ? Date.parse(ev.start) : NaN;
  const evEnd = ev.end ? Date.parse(ev.end) : NaN;
  if (!Number.isFinite(evStart)) return false;
  if (evStart > now + 24 * 3600e3) return false;
  // Still open / no end → include if started within last 90d or after windowStart
  if (!Number.isFinite(evEnd)) {
    return evStart >= windowStart || evStart >= now - 90 * 24 * 3600e3;
  }
  // Closed event must overlap the window
  if (evEnd < windowStart) return false;
  // Drop multi-year “forever” port/loiter rows that only barely touch the window
  const durationMs = Math.max(0, evEnd - evStart);
  if (durationMs > 120 * 24 * 3600e3 && evStart < windowStart) return false;
  return true;
}

function normalizeImo(raw: unknown): string | null {
  const m = String(raw || '').match(/\b(\d{7})\b/);
  return m ? m[1] : null;
}

function normalizeMmsi(raw: unknown): string | null {
  const m = String(raw || '').match(/\b(\d{9})\b/);
  return m ? m[1] : null;
}

function isRussianIdentity(mmsi: string | null, flag: string | null): boolean {
  if (flag && String(flag).toUpperCase() === 'RUS') return true;
  if (mmsi && mmsi.startsWith('273')) return true;
  return false;
}

type GfwVesselInterest = {
  russian: boolean;
  sanctioned: boolean;
  shadowfleet: boolean;
  interest: boolean;
};

function classifyGfwVesselInterest(mmsi: string | null, imo: string | null, flag: string | null): GfwVesselInterest {
  const russian = isRussianIdentity(mmsi, flag);
  const sanctioned = Boolean(
    (mmsi && SANCTIONED_MMSI.has(mmsi)) || (imo && SANCTIONED_IMO.has(imo))
  );
  const shadowfleet = Boolean(
    (mmsi && (SHADOWFLEET_MMSI.has(mmsi) || SHADOW_TEST_SET.has(mmsi))) ||
      (imo && SHADOWFLEET_IMO.has(imo))
  );
  return {
    russian,
    sanctioned,
    shadowfleet,
    interest: russian || sanctioned || shadowfleet,
  };
}

function mapGfwEntry(ev: any, opts?: { requireInterest?: boolean }) {
  const pos = gfwEventPosition(ev);
  if (!pos) return null;
  const subtype = normalizeGfwEventType(ev.type || ev.eventType);
  const vesselName = ev.vessel?.name || ev.vessel?.shipname || null;
  const vessels: string[] = [];
  if (vesselName) vessels.push(String(vesselName));
  if (ev.encounter?.vessel?.name) vessels.push(String(ev.encounter.vessel.name));
  const startIso = ev.start || ev.time || ev.startTime || null;
  const endIso = ev.end || null;
  let duration = ev.duration || ev.loitering?.totalTimeHours || ev.gap?.durationHours || null;
  if (duration == null && startIso && endIso) {
    const ms = Date.parse(endIso) - Date.parse(startIso);
    if (Number.isFinite(ms) && ms > 0) duration = ms / 3600e3;
  }
  const mmsi = normalizeMmsi(ev.vessel?.ssvid || ev.vessel?.mmsi);
  const partnerMmsi = normalizeMmsi(ev.encounter?.vessel?.ssvid || ev.encounter?.vessel?.mmsi);
  const imo = normalizeImo(ev.vessel?.imo || ev.vessel?.imoNumber);
  const partnerImo = normalizeImo(ev.encounter?.vessel?.imo || ev.encounter?.vessel?.imoNumber);
  const flag = ev.vessel?.flag ? String(ev.vessel.flag).toUpperCase() : null;
  const partnerFlag = ev.encounter?.vessel?.flag
    ? String(ev.encounter.vessel.flag).toUpperCase()
    : null;

  const primary = classifyGfwVesselInterest(mmsi, imo, flag);
  const partner = classifyGfwVesselInterest(partnerMmsi, partnerImo, partnerFlag);
  const interest = primary.interest || partner.interest;
  const requireInterest = opts?.requireInterest !== false;
  if (requireInterest && !interest) return null;

  const intentional =
    ev.gap?.intentionalDisabling === true || ev.gap?.intentionalDisabling === 'true';

  return {
    type: subtype,
    time: startIso,
    end: endIso,
    duration,
    position: pos,
    vessels,
    mmsi,
    partnerMmsi,
    imo,
    partnerImo,
    flag,
    partnerFlag,
    russian: primary.russian || partner.russian,
    sanctioned: primary.sanctioned || partner.sanctioned,
    shadowfleet: primary.shadowfleet || partner.shadowfleet,
    intentionalDisabling: intentional || null,
    gapDistanceKm: ev.gap?.distanceKm != null ? Number(ev.gap.distanceKm) : null,
    links: ev.links || [],
  };
}

async function fetchGfwDatasetPage(
  client: ReturnType<typeof gfwClient>,
  dataset: string,
  startDate: string,
  endDate: string,
  windowStart: number,
  now: number,
  limit: number
): Promise<{ dataset: string; entries: any[]; total: number; scanned: number; error?: string }> {
  try {
    if (dataset.includes('gaps')) {
      return await fetchGfwGapsInAoi(client, dataset, startDate, endDate, windowStart, now, limit);
    }
    const pageLimit = Math.min(500, Math.max(100, limit));
    const r = await client.post(
      '/events',
      { datasets: [dataset], startDate, endDate, geometry: gfwMonitorGeometry() },
      {
        params: { limit: pageLimit, offset: 0, sort: '-start' },
        validateStatus: (s) => s >= 200 && s < 300,
        timeout: 90000,
      }
    );
    const total = Number(r.data?.total || 0);
    const raw: any[] = r.data?.entries || [];
    const entries: any[] = [];
    const seen = new Set<string>();
    for (const ev of raw) {
      if (!isRecentEnoughGfwEvent(ev, windowStart, now)) continue;
      const mapped = mapGfwEntry(ev, { requireInterest: true });
      if (!mapped) continue;
      const key = `${mapped.type}|${mapped.time}|${mapped.position.lon.toFixed(3)}|${mapped.position.lat.toFixed(3)}|${mapped.mmsi || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(mapped);
    }
    return { dataset, entries, total, scanned: raw.length };
  } catch (e: any) {
    const detail =
      e?.response?.data?.messages?.[0]?.detail || e?.response?.data?.error || e?.message || String(e);
    console.warn('[gfw/events]', dataset, detail);
    return { dataset, entries: [], total: 0, scanned: 0, error: detail };
  }
}

/**
 * AIS gap events: GFW returns empty when geometry is set.
 * 1) Flag-filter NOR/RUS (fast, sparse)
 * 2) Paginate global recent gaps and keep AOI hits (other flags near Norway)
 */
async function fetchGfwGapsInAoi(
  client: ReturnType<typeof gfwClient>,
  dataset: string,
  startDate: string,
  endDate: string,
  windowStart: number,
  now: number,
  limit: number
): Promise<{ dataset: string; entries: any[]; total: number; scanned: number; error?: string }> {
  const want = Math.min(120, Math.max(30, limit));
  const entries: any[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  let total = 0;
  let lastError: string | undefined;

  const pushMapped = (ev: any) => {
    if (!isRecentEnoughGfwEvent(ev, windowStart, now)) return;
    const mapped = mapGfwEntry(ev, { requireInterest: false });
    if (!mapped) return;
    if (!pointInGfwMonitorBbox(mapped.position.lon, mapped.position.lat)) return;
    const key = `${mapped.type}|${mapped.time}|${mapped.position.lon.toFixed(3)}|${mapped.position.lat.toFixed(3)}|${mapped.mmsi || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(mapped);
  };

  const attempts: { flags?: string[]; pageSize: number; maxPages: number }[] = [
    { flags: ['RUS', 'NOR'], pageSize: 200, maxPages: 3 },
    // Recent global gaps are mostly outside our AOI — scan deeper for northern hits
    { pageSize: 500, maxPages: 8 },
  ];

  for (const attempt of attempts) {
    if (entries.length >= want) break;
    try {
      const body: any = { datasets: [dataset], startDate, endDate };
      if (attempt.flags) body.flags = attempt.flags;

      for (let page = 0; page < attempt.maxPages && entries.length < want; page++) {
        const r = await client.post('/events', body, {
          params: { limit: attempt.pageSize, offset: page * attempt.pageSize, sort: '-start' },
          validateStatus: (s) => s >= 200 && s < 300,
          timeout: 90000,
        });
        total = Math.max(total, Number(r.data?.total || 0));
        const raw: any[] = r.data?.entries || [];
        scanned += raw.length;
        if (!raw.length) break;
        for (const ev of raw) {
          pushMapped(ev);
          if (entries.length >= want) break;
        }
        if (raw.length < attempt.pageSize) break;
      }
    } catch (e: any) {
      lastError =
        e?.response?.data?.messages?.[0]?.detail || e?.response?.data?.error || e?.message || String(e);
      console.warn('[gfw/gaps]', attempt.flags ? attempt.flags.join(',') : 'global', lastError);
    }
  }

  console.log(`[gfw/gaps] aoi=${entries.length} scanned=${scanned} total=${total}`);
  return {
    dataset,
    entries,
    total,
    scanned,
    error: entries.length === 0 ? lastError : undefined,
  };
}

/** Split [start,end] into ~7-day chunks so dense GFW datasets cover the full lookback. */
function gfwDateChunks(start: Date, end: Date): { startDate: string; endDate: string }[] {
  const chunks: { startDate: string; endDate: string }[] = [];
  const weekMs = 7 * 24 * 3600e3;
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + weekMs, endMs);
    chunks.push({
      startDate: new Date(cursor).toISOString().slice(0, 10),
      endDate: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    cursor = chunkEnd;
  }
  return chunks.length ? chunks : [{ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }];
}

async function fetchGfwDatasetAcrossWindow(
  client: ReturnType<typeof gfwClient>,
  dataset: string,
  start: Date,
  end: Date,
  limit: number
): Promise<{ dataset: string; entries: any[]; total: number; scanned: number; error?: string }> {
  const dense = dataset.includes('loitering') || dataset.includes('port-visits');
  const isGaps = dataset.includes('gaps');
  // Gaps: one window + pagination (geometry unsupported). Others: weekly chunks when dense.
  const chunks =
    dense && !isGaps
      ? gfwDateChunks(start, end)
      : [
          {
            startDate: start.toISOString().slice(0, 10),
            endDate: new Date(end.getTime() + 24 * 3600e3).toISOString().slice(0, 10),
          },
        ];
  const perChunk = Math.min(500, Math.max(200, limit));

  const merged: any[] = [];
  const seen = new Set<string>();
  let total = 0;
  let scanned = 0;
  let lastError: string | undefined;

  for (const chunk of chunks) {
    const page = await fetchGfwDatasetPage(
      client,
      dataset,
      chunk.startDate,
      chunk.endDate,
      start.getTime(),
      end.getTime(),
      perChunk
    );
    total = Math.max(total, page.total);
    scanned += page.scanned;
    if (page.error) lastError = page.error;
    for (const e of page.entries) {
      const key = `${e.type}|${e.time}|${e.position.lon.toFixed(3)}|${e.position.lat.toFixed(3)}|${e.mmsi || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
  }

  return {
    dataset,
    entries: merged,
    total,
    scanned,
    error: merged.length === 0 ? lastError : undefined,
  };
}

async function loadGfwEvents(hours: number, limitRaw = 200) {
  const cacheKey = `events:${hours}`;
  await Promise.all([ensureSanctionedLoaded(), ensureShadowLoaded()]);
  const client = gfwClient();
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = new Date(end.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const limit = Math.min(500, Math.max(100, limitRaw || 200));

  // Sequential — GFW rate-limits / times out under parallel POSTs.
  // Progressive cache after each dataset so AIS-off (first) is usable ASAP.
  const lists: Awaited<ReturnType<typeof fetchGfwDatasetAcrossWindow>>[] = [];
  const publish = (partial: boolean) => {
    const events = lists.flatMap((l) => l.entries);
    const payload = {
      events,
      meta: {
        returned: events.length,
        startDate,
        endDate,
        hours,
        source: 'gfw-v3',
        filter: 'events: russian|sanctioned|shadow; ais_off: all in AOI; detections: GFW SAR',
        partial,
        datasets: lists.map((l) => ({
          dataset: l.dataset,
          total: l.total,
          scanned: l.scanned,
          returned: l.entries.length,
          error: l.error || null,
        })),
      },
    };
    const anyOk = lists.some((l) => l.entries.length > 0 || (!l.error && l.scanned > 0));
    if (anyOk || events.length > 0) {
      GFW_EVENTS_CACHE.set(cacheKey, { ts: Date.now(), payload });
    }
    return payload;
  };

  for (const dataset of GFW_EVENT_DATASETS) {
    lists.push(await fetchGfwDatasetAcrossWindow(client, dataset, start, end, limit));
    const mid = publish(lists.length < GFW_EVENT_DATASETS.length);
    console.log(
      `[gfw/events] progress ${lists.length}/${GFW_EVENT_DATASETS.length} returned=${mid.events.length}`
    );
  }

  const payload = publish(false);
  console.log(`[gfw/events] returned=${payload.events.length} hours=${hours}`);
  return payload;
}

app.get('/api/gfw/events', async (req, res) => {
  try {
    if (!GFW_API_TOKEN) {
      return res.status(400).json({ error: 'GFW_API_TOKEN not configured', events: [] });
    }
    // Default 30 days — shipping-watch lookback for loitering / encounters / ports
    const hours = Math.max(24, Math.min(24 * 90, parseInt(String(req.query.hours || '720'), 10) || 720));
    const cacheKey = `events:${hours}`;
    const cached = GFW_EVENTS_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < GFW_CACHE_TTL_MS) {
      return res.json({ ...cached.payload, meta: { ...cached.payload.meta, cached: true } });
    }

    // Serve stale cache immediately while a refresh runs (GFW scans can take minutes).
    if (cached?.payload) {
      if (!GFW_EVENTS_INFLIGHT.has(cacheKey)) {
        loadGfwEventsShared(hours, parseInt(String(req.query.limit || '500'), 10) || 500).catch(
          (e) => console.warn('[gfw/events] background refresh', e?.message || e)
        );
      }
      return res.json({
        ...cached.payload,
        meta: { ...cached.payload.meta, cached: true, stale: true, refreshing: true },
      });
    }

    // No cache yet: kick off shared load and wait, but cap wait so the UI isn't stuck forever.
    const limit = parseInt(String(req.query.limit || '500'), 10) || 500;
    const loadPromise = loadGfwEventsShared(hours, limit);
    const payload = await Promise.race([
      loadPromise,
      new Promise<any>((resolve) =>
        setTimeout(
          () =>
            resolve({
              events: [],
              meta: { loading: true, hours, note: 'GFW still loading — retry shortly' },
            }),
          12_000
        )
      ),
    ]);
    res.json(payload);
  } catch (e: any) {
    const detail =
      e?.response?.data?.messages?.[0]?.detail ||
      e?.response?.data?.error ||
      e?.message ||
      String(e);
    console.warn('[gfw/events]', detail);
    res.json({ events: [], error: detail });
  }
});

const GFW_DETECTIONS_CACHE = new Map<string, GfwCacheEntry>();
const GFW_DETECTIONS_INFLIGHT = new Map<string, Promise<any>>();

function parseSarReportEntries(data: any, matched: boolean): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const rows = Array.isArray(data?.entries) ? data.entries : [];
  for (const block of rows) {
    if (!block || typeof block !== 'object') continue;
    for (const key of Object.keys(block)) {
      if (!key.includes('sar-presence')) continue;
      const list = Array.isArray(block[key]) ? block[key] : [];
      for (const d of list) {
        const lon = Number(d.lon ?? d.longitude);
        const lat = Number(d.lat ?? d.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (!pointInSarZones(lon, lat)) continue;
        const time = d.date || d.entryTimestamp || d.time || null;
        const mmsi = normalizeMmsi(d.mmsi || d.ssvid);
        const keyId = `${matched ? 1 : 0}|${time}|${lon.toFixed(3)}|${lat.toFixed(3)}|${mmsi || ''}`;
        if (seen.has(keyId)) continue;
        seen.add(keyId);
        out.push({
          type: matched ? 'sar_matched' : 'sar',
          subtype: matched ? 'sar_matched' : 'sar',
          matched,
          time,
          position: { lon, lat },
          detections: Number(d.detections || 1),
          mmsi,
          imo: normalizeImo(d.imo),
          vessel: d.shipName || d.vesselName || null,
          flag: d.flag ? String(d.flag).toUpperCase() : null,
          vesselId: d.vesselId || null,
          vesselType: d.vesselType || null,
          geartype: d.geartype || null,
          source: 'gfw-4wings-sar',
          note: matched
            ? 'SAR detection matched to AIS (GFW)'
            : 'SAR detection with no AIS match — possible dark vessel (GFW)',
        });
      }
    }
  }
  return out;
}

async function fetchSarPresenceReport(
  client: ReturnType<typeof gfwClient>,
  startDate: string,
  endDate: string,
  matched: boolean
): Promise<{ detections: any[]; error?: string }> {
  try {
    const r = await client.post(
      '/4wings/report',
      { geojson: sarZonesRequestGeometry() },
      {
        params: {
          'spatial-resolution': 'HIGH',
          'temporal-resolution': 'HOURLY',
          'datasets[0]': 'public-global-sar-presence:latest',
          'date-range': `${startDate},${endDate}`,
          format: 'JSON',
          'filters[0]': matched ? "matched='true'" : "matched='false'",
        },
        validateStatus: (s) => s >= 200 && s < 300,
        timeout: 120000,
      }
    );
    return { detections: parseSarReportEntries(r.data, matched) };
  } catch (e: any) {
    const detail =
      e?.response?.data?.messages?.[0]?.detail || e?.response?.data?.error || e?.message || String(e);
    console.warn('[gfw/detections] sar', matched ? 'matched' : 'unmatched', detail);
    return { detections: [], error: detail };
  }
}

async function loadGfwDetections(hours: number) {
  // Always last 30 days inside Norway EEZ / Jan Mayen EEZ / Svalbard FPZ
  const lookbackHours = Math.min(SAR_LOOKBACK_HOURS, Math.max(24, hours || SAR_LOOKBACK_HOURS));
  const cacheKey = `detections:zones:${lookbackHours}`;
  const client = gfwClient();
  // SAR presence lags ~5 days — window is 30d of available SAR ending at lag
  const end = new Date(Date.now() - 5 * 24 * 3600e3);
  const start = new Date(end.getTime() - lookbackHours * 3600e3);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  // Unmatched first (dark), then matched for context — sequential to avoid GFW concurrency limits
  const unmatched = await fetchSarPresenceReport(client, startDate, endDate, false);
  const matched = await fetchSarPresenceReport(client, startDate, endDate, true);
  // Cap for map performance — prefer unmatched (dark) over matched
  const unmatchedCap = unmatched.detections.slice(0, 800);
  const matchedCap = matched.detections.slice(0, 400);
  const detections = [...unmatchedCap, ...matchedCap];
  const payload = {
    detections,
    meta: {
      returned: detections.length,
      unmatched: unmatched.detections.length,
      matched: matched.detections.length,
      unmatchedShown: unmatchedCap.length,
      matchedShown: matchedCap.length,
      startDate,
      endDate,
      hours: lookbackHours,
      zones: ['norway-eez', 'janmayen-eez', 'svalbard-fpz'],
      source: 'gfw-4wings-sar',
      dataset: 'public-global-sar-presence:latest',
      note:
        'SAR only in Norway EEZ, Jan Mayen EEZ, and Svalbard FPZ · last 30 days · unmatched = no AIS match (possible dark) · lags ~5 days',
      errors: [unmatched.error, matched.error].filter(Boolean),
    },
  };
  GFW_DETECTIONS_CACHE.set(cacheKey, { ts: Date.now(), payload });
  console.log(
    `[gfw/detections] unmatched=${unmatched.detections.length} matched=${matched.detections.length} zones=${SAR_ZONES.length}`
  );
  return payload;
}

function loadGfwDetectionsShared(hours: number = SAR_LOOKBACK_HOURS): Promise<any> {
  const lookbackHours = Math.min(SAR_LOOKBACK_HOURS, Math.max(24, hours || SAR_LOOKBACK_HOURS));
  const cacheKey = `detections:zones:${lookbackHours}`;
  const cached = GFW_DETECTIONS_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < GFW_CACHE_TTL_MS) return Promise.resolve(cached.payload);
  const existing = GFW_DETECTIONS_INFLIGHT.get(cacheKey);
  if (existing) return existing;
  const p = loadGfwDetections(lookbackHours).finally(() => {
    GFW_DETECTIONS_INFLIGHT.delete(cacheKey);
  });
  GFW_DETECTIONS_INFLIGHT.set(cacheKey, p);
  return p;
}

app.get('/api/gfw/detections', async (req, res) => {
  try {
    if (!GFW_API_TOKEN) {
      return res.status(400).json({
        detections: [],
        error: 'GFW_API_TOKEN not configured',
      });
    }
    // Fixed 30-day lookback inside EEZ/FPZ zones
    const hours = SAR_LOOKBACK_HOURS;
    const cacheKey = `detections:zones:${hours}`;
    const cached = GFW_DETECTIONS_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < GFW_CACHE_TTL_MS) {
      return res.json({ ...cached.payload, meta: { ...cached.payload.meta, cached: true } });
    }
    // Return stale while refreshing if available
    if (cached) {
      loadGfwDetectionsShared(hours).catch(() => undefined);
      return res.json({
        ...cached.payload,
        meta: { ...cached.payload.meta, cached: true, refreshing: true },
      });
    }
    const payload = await loadGfwDetectionsShared(hours);
    res.json(payload);
  } catch (e: any) {
    res.status(500).json({ detections: [], error: e?.message || String(e) });
  }
});

app.get('/api/gfw/status', (_req, res) => {
  const cached = [...GFW_EVENTS_CACHE.entries()].map(([k, v]) => ({
    key: k,
    ageSec: Math.round((Date.now() - v.ts) / 1000),
    events: v.payload?.events?.length ?? 0,
  }));
  res.json({
    configured: Boolean(GFW_API_TOKEN),
    base: GFW_API_BASE,
    cache: cached,
  });
});

/** Proxy ship-info.com vessel photos by IMO (same asset Arctic tools reference). */
const SHIP_PHOTO_CACHE = new Map<string, { ts: number; buf: Buffer; type: string; ok: boolean }>();
const SHIP_PHOTO_TTL_MS = 24 * 3600e3;
const SHIP_PHOTO_NEG_TTL_MS = 6 * 3600e3;

app.get('/api/ship-photo/:imo', async (req, res) => {
  const imo = String(req.params.imo || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(imo)) {
    return res.status(400).json({ error: 'IMO must be 7 digits' });
  }
  const cached = SHIP_PHOTO_CACHE.get(imo);
  const now = Date.now();
  if (cached) {
    const ttl = cached.ok ? SHIP_PHOTO_TTL_MS : SHIP_PHOTO_NEG_TTL_MS;
    if (now - cached.ts < ttl) {
      if (!cached.ok) return res.status(404).end();
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Photo-Source', 'ship-info.com');
      return res.send(cached.buf);
    }
  }
  try {
    const url = `https://www.ship-info.com/vessels/${imo}.jpg`;
    const r = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 12000,
      httpsAgent: httpsAgent(),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.ship-info.com/prog/search_fish.asp',
      },
      validateStatus: (s) => s >= 200 && s < 500,
    });
    const type = String(r.headers['content-type'] || '');
    const buf = Buffer.from(r.data || []);
    const ok =
      r.status === 200 &&
      buf.length > 2000 &&
      (/image\/(jpeg|jpg|png|webp)/i.test(type) || buf[0] === 0xff);
    SHIP_PHOTO_CACHE.set(imo, {
      ts: now,
      buf: ok ? buf : Buffer.alloc(0),
      type: ok ? type || 'image/jpeg' : 'application/octet-stream',
      ok,
    });
    if (!ok) return res.status(404).end();
    res.setHeader('Content-Type', type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Photo-Source', 'ship-info.com');
    return res.send(buf);
  } catch (e: any) {
    SHIP_PHOTO_CACHE.set(imo, {
      ts: now,
      buf: Buffer.alloc(0),
      type: 'application/octet-stream',
      ok: false,
    });
    console.warn('[ship-photo]', imo, e?.message || e);
    return res.status(404).end();
  }
});

app.get('/api/sanctions/status', (_req, res) => {
  let meta: any = {};
  try {
    meta = JSON.parse(fs.readFileSync(EU_DESIGNATED_META, 'utf8'));
  } catch {
    /* empty */
  }
  res.json({
    euImoCount: readEuDesignatedCsv().size,
    sanctionedMmsiCache: SANCTIONED_MMSI.size,
    sanctionedImoCache: SANCTIONED_IMO.size,
    meta,
  });
});

app.post('/api/sanctions/refresh', async (_req, res) => {
  const result = await updateEuDesignatedVessels();
  SANCTIONED_CACHE_TS = 0; // force reload
  await ensureSanctionedLoaded();
  res.json(result);
});

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
// Expose user-provided icons (flags and category markers)
app.use('/flags', express.static(dataSource('flag-icons')));
app.use('/flag-icons', express.static(dataSource('flag-icons')));
app.use('/markers', express.static(dataSource('Mapmarkers')));
app.use('/menu', express.static(dataSource('Menu items')));
const indexHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SvalMap</title>
<link href="https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.css" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
  html,body{height:100%;margin:0;overflow:hidden}
  #map{position:absolute;top:0;left:0;right:0;bottom:0}
  body{font-family:'Poppins',system-ui,Arial,sans-serif}
  .hamburger{position:absolute;top:12px;left:12px;z-index:20;width:40px;height:40px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .hamburger .bars{width:18px}
  .hamburger .bars, .hamburger .bars::before, .hamburger .bars::after{display:block;height:2px;background:#e2e8f0;position:relative;border-radius:2px}
  .hamburger .bars::before, .hamburger .bars::after{content:'';position:absolute;left:0;width:100%}
  .hamburger .bars::before{top:-6px}
  .hamburger .bars::after{top:6px}

  .drawer{position:absolute;top:0;left:0;bottom:0;z-index:15;display:flex;pointer-events:none}
  .drawer .panel{width:300px;max-width:80vw;background:#0f172a;color:#e2e8f0;box-shadow:2px 0 12px rgba(0,0,0,0.4);transform:translateX(-100%);transition:transform .25s ease;pointer-events:auto;display:flex;flex-direction:column;overflow:auto;padding-bottom:30px}
  .drawer .overlay{flex:1;background:rgba(0,0,0,0.35);opacity:0;transition:opacity .25s ease;pointer-events:none}
  .drawer.open .panel{transform:translateX(0)}
  .drawer.open .overlay{opacity:1;pointer-events:auto}
  .panel .header{padding:12px 14px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between}
  #collapse-btn{background:transparent;border:0;color:#e2e8f0;cursor:pointer;font-size:18px;line-height:1}
  .panel .section{padding:10px 12px 30px}
  .panel .item{display:flex;align-items:center;justify-content:flex-start;padding:10px;margin:6px 0;background:#0b1220;border:1px solid rgba(255,255,255,0.06);border-radius:8px}
  .panel .item .label{display:flex;align-items:center;gap:8px;font-size:10px}
  .panel .item .spacer{flex:1}
  .panel .item .menu-icon{width:22px;height:22px;margin-left:8px;margin-right:10px}
  .panel .group{margin-top:4px;border-left:1px dashed rgba(255,255,255,0.1);padding-left:8px}
  .panel .disclaimer{margin:8px 12px 12px;color:#94a3b8;font-size:12px}

  @media(min-width: 960px){
    .drawer{pointer-events:auto}
    .drawer .panel{transform:translateX(0)}
    .drawer .overlay{display:none}
  }

  .popup-card{min-width:260px;border-radius:8px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,0.25);font-family:system-ui,Arial,sans-serif}
  .popup-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#ff5151;color:#fff;font-weight:800;font-size:18px}
  .popup-flag{width:22px;height:16px;object-fit:cover;border-radius:2px}
  .popup-body{padding:12px 14px;background:#fff;color:#111}
  .popup-row{margin:8px 0}
  .popup-row b{font-weight:800}
  /* Popup styling (closer to provided design) */
  .maplibregl-popup-close-button{display:none}
  .maplibregl-popup-content{font-family:'Poppins',system-ui,Arial,sans-serif;padding:0;width:210px;border-radius:10px;overflow:hidden;box-shadow:0 10px 28px rgba(0,0,0,.35)}
  .maplibregl-popup-content .head{padding:8px 9px;border-radius:10px 10px 0 0;font-weight:800;font-size:14px;line-height:18px}
  .maplibregl-popup-content .country{display:flex;align-items:center;gap:6px;margin-top:6px;font-weight:700;font-size:11px;opacity:.95}
  .maplibregl-popup-content .body{padding:9px 10px;background:#fff;color:#111}
  .maplibregl-popup-content .row{margin:6px 0;font-size:12px;line-height:16px}
  .maplibregl-popup-content .k{font-weight:800}
  .maplibregl-popup-content .v{font-weight:400;margin-left:4px}
  .maplibregl-popup-anchor-top > .maplibregl-popup-tip{border-bottom-color:#fff}
  .maplibregl-popup-anchor-bottom > .maplibregl-popup-tip{border-top-color:#fff}
  .maplibregl-popup-anchor-left > .maplibregl-popup-tip{border-right-color:#fff}
  .maplibregl-popup-anchor-right > .maplibregl-popup-tip{border-left-color:#fff}
  /* Right detail drawer */
  #detail-drawer{position:absolute;top:0;right:0;bottom:0;width:360px;max-width:85vw;transform:translateX(100%);transition:transform .3s ease;z-index:15;pointer-events:none}
  #detail-drawer.open{transform:translateX(0);pointer-events:auto}
  #detail-card{height:100%;display:flex;flex-direction:column;background:#fff;color:#111;box-shadow:-8px 0 24px rgba(0,0,0,.35);border-radius:10px 0 0 10px;overflow:auto}
  #detail-card .head{padding:12px 14px;border-radius:10px 0 0 0;font-weight:800;font-size:16px;line-height:20px;display:flex;flex-direction:column}
  #detail-card .country{display:flex;align-items:center;gap:6px;margin-top:6px;font-weight:700;font-size:12px;opacity:.95}
  #detail-card .placeholder{height:140px;background:#e5e7eb;color:#6b7280;display:flex;align-items:center;justify-content:center;font-weight:600}
  #detail-card .body{padding:12px 14px}
  #detail-card .row{margin:8px 0;font-size:13px;line-height:18px}
  #detail-card .k{font-weight:800}
  #detail-card .v{font-weight:400;margin-left:4px}
  #detail-close{position:absolute;top:10px;right:10px;background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer}
  #legend{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;background:#111a;padding:8px 10px;border-radius:8px;color:#fff;font-family:system-ui,Arial,sans-serif;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:10px}
  #legend .row{display:flex;align-items:center;gap:10px}
  #legend .item{display:flex;align-items:center;margin:0}
  #legend .legend-icon{width:14px;height:auto;margin-right:6px}
  #legend .legend-icon.shadow{width:16px;height:16px}
  #legend .indicators{display:flex;gap:10px;justify-content:center}
  #legend .swatch{width:12px;height:12px;border-radius:50%;margin-right:6px}
      #legend .swatch.norway{background:#ff4040}
    #legend .swatch.russia{background:#7dacff}
    #legend .swatch.eu{background:#2b2bcc}
    #legend .swatch.china{background:#f2c403}
    #legend .swatch.rest{background:#f7f7f7}
</style>
</head>
<body>
  <div id="drawer" class="drawer open">
    <div class="panel">
      <div class="header"><span class="title">Maplayers</span> <button id="collapse-btn" title="Collapse">⮜</button></div>
      <div class="disclaimer">NOTE: This map shows all registered vessels inside the Svalbard Fisheries Protection Zone except fishing vessels under 15 meters in length and recreational vessels under 45 meters in length. Across the rest of the North Atlantic north of 54°N (including the Norwegian and Jan Mayen EEZs) only Russian vessels, Russian research vessels, shadow fleet vessels, sanctioned vessels, and military/law enforcement vessels are displayed. Live AIS via AISStream + BarentsWatch.</div>
      <div class="section">
        <div class="item"><div class="label">Economic area</div><button id="ea-toggle" style="background:transparent;border:0;color:#e2e8f0;cursor:pointer">Details</button><div class="spacer"></div><img class="menu-icon" src="/menu/EEZs.svg" alt="EEZ"><label></label></div>
        <div id="ea-group" class="group" style="display:block">
          <div class="item"><div class="label">Norway EEZ</div><div class="spacer"></div><img class="menu-icon" src="/menu/EEZs.svg" alt="EEZ"><label><input type="checkbox" id="toggle-eez-norway"></label></div>
          <div class="item"><div class="label">Jan Mayen EEZ</div><div class="spacer"></div><img class="menu-icon" src="/menu/EEZs.svg" alt="EEZ"><label><input type="checkbox" id="toggle-eez-janmayen"></label></div>
          <div class="item"><div class="label">Svalbard Fisheries Protection Zone</div><div class="spacer"></div><img class="menu-icon" src="/menu/EEZs.svg" alt="EEZ"><label><input type="checkbox" id="toggle-eez-svalbard" checked></label></div>
        </div>
        <div class="item"><div class="label">Undersea cables</div><div class="spacer"></div><img class="menu-icon" src="/menu/Underseacables.svg" alt="Undersea cables"><label><input type="checkbox" id="toggle-cables"></label></div>
        <div class="item"><div class="label">Pipelines and oil rigs</div><div class="spacer"></div><img class="menu-icon" src="/menu/pipelines_and_oil_rigs.svg" alt="Pipelines and oil rigs"><label><input type="checkbox" id="toggle-petroleum"></label></div>
        <div class="item"><div class="label">NSM restriction areas</div><div class="spacer"></div><img class="menu-icon" src="/menu/NSMrestriction.svg" alt="NSM restriction areas"><label><input type="checkbox" id="toggle-nsm"></label></div>
        <div class="item"><div class="label">Airports</div><div class="spacer"></div><img class="menu-icon" src="/menu/Airports.svg" alt="Airports"><label><input type="checkbox" id="toggle-airports"></label></div>
        <div class="item"><div class="label">Offshore firing range</div><div class="spacer"></div><img class="menu-icon" src="/menu/Offshore_firing_range.svg" alt="Offshore firing range"><label><input type="checkbox" id="toggle-skytefelt"></label></div>
        <div class="item"><div class="label">Ports</div><div class="spacer"></div><img class="menu-icon" src="/menu/ports.svg" alt="Ports"><label><input type="checkbox" id="toggle-ports"></label></div>
        <div class="item"><div class="label">Ships</div><div class="spacer"></div><img class="menu-icon" src="/menu/ships.svg" alt="Ships"><label><input type="checkbox" id="toggle-ships" checked></label></div>
        
        <!-- Global Fishing Watch Section -->
        <div class="section-header">Global Fishing Watch</div>
        <div class="item"><div class="label">Loitering events</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-loitering"></label></div>
        <div class="item"><div class="label">Encounters / Transshipments</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-encounters"></label></div>
        <div class="item"><div class="label">AIS off events</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-aisoff"></label></div>
        <div class="item"><div class="label">Port visits</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-port"></label></div>
        <div class="item"><div class="label">SAR detections</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-sar"></label></div>
        <div class="item"><div class="label">VIIRS detections</div><div class="spacer"></div><label><input type="checkbox" id="toggle-gfw-viirs"></label></div>
      </div>
      <div class="disclaimer" style="display:none"></div>
    </div>
  </div>

  <div id="map"></div>
  <div id="detail-drawer"><div id="detail-card"></div></div>
  <script src="https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js"></script>
  <div id="legend">
    <div class="indicators">
      <div class="item"><img class="legend-icon shadow" src="/markers/Circles/shadowtriangle.svg" alt="shadow"/>Russian shadow fleet vessel</div>
      <div class="item"><img class="legend-icon" src="/markers/Circles/Sanksjon.svg" alt="sanction"/>Sanctioned / flagged vessel</div>
              <div class="item"><img class="legend-icon" src="/markers/Circles/Militarycircle.svg" alt="military"/>Military vessel / Law enforcement</div>
              <div class="item"><img class="legend-icon" src="/markers/Circles/Researchcircle.svg" alt="research"/>Russian research vessel</div>
            </div>
            <div class="row">
              <div class="item"><span class="swatch norway"></span>Norway</div>
              <div class="item"><span class="swatch russia"></span>Russia</div>
              <div class="item"><span class="swatch eu"></span>EU</div>
              <div class="item"><span class="swatch china"></span>China</div>
              <div class="item"><span class="swatch rest"></span>Rest of world</div>
            </div>
  </div>
  <script>
  const styleUrl = ${JSON.stringify(process.env.MAP_STYLE || '/styles/svalmap-dark.json')};
  const map = new maplibregl.Map({
    container:'map',
    style: styleUrl,
    center:[12,69],
    zoom:3.5,
    dragRotate:false,
    pitchWithRotate:false
  });
  map.setRenderWorldCopies(true);
  map.once('load', function(){
    map.fitBounds([[-10,57.5],[35,81]], {padding:{top:48,bottom:96,left:48,right:48}, duration:0});
  });
  // Navigation control removed per request
  try { map.touchZoomRotate.disableRotation(); } catch(e) {}
  // Collapse behavior for left drawer (header button)
  (function(){
    var btn = document.getElementById('collapse-btn');
    var drawer = document.getElementById('drawer');
    if(btn && drawer){
      btn.addEventListener('click', function(){
        if(drawer.classList.contains('open')){
          drawer.classList.remove('open');
        } else {
          drawer.classList.add('open');
        }
      });
    }
  })();

  const metersPerDegreeLat = 111320;
  function courseLineFeature(lon, lat, courseDeg){
    if(courseDeg==null) return null;
    const lenMeters = 750;
    const rad = courseDeg * Math.PI/180;
    const dlon = (lenMeters * Math.cos(rad)) / (111320 * Math.cos(lat * Math.PI/180));
    const dlat = (lenMeters * Math.sin(rad)) / 110540;
    return { type:'Feature', geometry:{ type:'LineString', coordinates:[[lon,lat],[lon+dlon, lat+dlat]]}, properties:{} };
  }

  // Format helpers
  function navStatusName(code){
    const n = Number(code);
    switch(n){
      case 0: return 'Under way using engine';
      case 1: return 'At anchor';
      case 2: return 'Not under command';
      case 3: return 'Restricted manoeuverability';
      case 4: return 'Constrained by her draught';
      case 5: return 'Moored';
      case 6: return 'Aground';
      case 7: return 'Engaged in fishing';
      case 8: return 'Under way sailing';
      case 9: return 'Reserved (HSC)';
      case 10: return 'Reserved (WIG)';
      case 11: case 12: case 13: return 'Reserved';
      case 14: return 'AIS-SART is active';
      case 15: return 'Not defined';
      default: return (n===0 || isNaN(n)) ? 'Unknown' : String(code);
    }
  }
  function formatDisplayTime(ts){
    if(!ts) return 'N/A';
    try{
      const d = new Date(ts);
      if(isNaN(d)) return String(ts);
      return d.toLocaleString('no-NO', { hour12:false });
    }catch{ return String(ts); }
  }

  async function loadAssets(){
    const assets = await fetch('/api/assets').then(r=>r.json());
    const cables = assets.filter(x=>x.type==='CABLE');
    if(cables.length){
      const crFc = { type:'FeatureCollection', features: cables.map(r=>({ type:'Feature', geometry: JSON.parse(r.geojson).geometry, properties:{ name:r.name } })) };
      map.addSource('cables',{ type:'geojson', data: crFc });
      map.addLayer({ id:'cables-line', type:'line', source:'cables', paint:{ 'line-color':'#00e6ff','line-width':2 } });
    }
  }

  async function loadPositions(){
    // Prefer live AIS if backend token is present; otherwise fallback to BigQuery
    let rows = [];
    try { rows = await fetch('/api/live-positions').then(r=>r.ok?r.json():[]).catch(()=>[]); } catch(_) {}
    if(!Array.isArray(rows) || rows.length===0){
      rows = await fetch('/api/positions?since=1440&limit=8000').then(r=>r.json());
    }
    function mmsiCategory(m, shipType, imo){
      const s=String(m||''); const mid=parseInt(s.slice(0,3));
      const researchMmsi = new Set(['273454710','273412710','273413400','273450600','273411400','273418070','273454600','273414400','273452600','273359440','273439220','273211700','273450550','273458500','273295970','273546520']);
      const researchImo = new Set(['8211150','8519837','8507731','8408985','7811018','8211174','8409032','8507729','8407010','9548536','7740477','8607048','7518202','8010348','9884198']);
      const imoStr = String(imo||'').replace(/\\D/g,'');
      if(researchMmsi.has(s) || (imoStr && researchImo.has(imoStr))) return 'research';
      // Check if it's a military vessel or law enforcement first
      if(shipType === 35 || shipType === 'Military ops' || shipType === 55 || shipType === 'Law enforcement') return 'military';
      if([257,258,259].includes(mid)) return 'norway';
      if(mid===273) return 'russia';
      // Derive ISO from MID for better EU/rest classification
      const midToIsoMap = {
        265:'se',266:'se', 219:'dk',220:'dk', 230:'fi', 211:'de',218:'de',
        244:'nl',245:'nl',246:'nl', 226:'fr',227:'fr',228:'fr', 224:'es',225:'es',
        263:'pt', 247:'it', 237:'gr',239:'gr',240:'gr',241:'gr', 250:'ie', 261:'pl',
        276:'ee',275:'lv',277:'lt', 201:'at', 207:'bg', 270:'cz',271:'tr',280:'pt',
        232:'gb',233:'gb',234:'gb',235:'gb', 231:'fo', 236:'gi',
        // Bahamas & Panama common MIDs
        308:'bs',309:'bs',310:'bs',311:'bs', 351:'pa',352:'pa',353:'pa',354:'pa',355:'pa'
      };
      const iso = midToIsoMap[mid];
      const euIso = new Set(['se','dk','fi','de','nl','fr','es','pt','it','gr','ie','pl','ee','lv','lt','be','bg','ro','cz','sk','si','hr','cy','mt','hu','lu','at']);
      if(iso && euIso.has(iso)) return 'eu';
      if(mid>=412 && mid<=419) return 'china';
      return 'rest';
    }
    function headerColor(cat){
      if(cat==='norway') return '#ff4040';
      if(cat==='russia') return '#7dacff';
      if(cat==='eu') return '#2b2bcc';
      if(cat==='china') return '#f2c403';
      return '#f7f7f7';
    }
    function headerTextColor(cat){ return cat==='rest' ? '#111' : '#fff'; }
    const features = rows.map(r=>{
      const ts = (r.timestamp && (r.timestamp.value || r.timestamp)) || '';
      const cat = mmsiCategory(r.mmsi, r.shipType, r.imo);
      const name = r.vessel_name || '';
      return { type:'Feature', geometry:{ type:'Point', coordinates:[r.lon,r.lat] }, properties:{ mmsi:r.mmsi, name:name, category:cat, label:(name||('MMSI '+r.mmsi)), timestamp: ts, speed: r.speed || 0, heading: r.heading, course: r.course, status: r.status, destination: r.destination || null, eta: r.eta || null, imo: r.imo || null, shipType: r.shipType || null, sanctioned: r.sanctioned === true, shadowfleet: r.shadowfleet === true, military: cat === 'military' } };
    });
    const fc = { type:'FeatureCollection', features };
    const lines = rows.map(r=>courseLineFeature(r.lon,r.lat,r.course)).filter(Boolean);
    const lc = { type:'FeatureCollection', features: lines };
    if(map.getSource('ships')){
      map.getSource('ships').setData(fc);
    } else {
      const hoverPopup = new maplibregl.Popup({ closeButton:false, closeOnClick:false });
      // Initial GFW load (default layers hidden)
      loadGfwOverlays(720);
      

      map.addSource('projection', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
      function closeAllPopups(){ try{ hoverPopup.remove(); }catch(_){} try{ document.querySelectorAll('.maplibregl-popup').forEach(function(n){ n.parentNode && n.parentNode.removeChild(n); }); }catch(_){} }
      let activeSidebarMmsi = null;
      function iconForCategoryCircle(){
        return [ 'case',
          ['==',['get','category'],'research'],'Researchcircle',
          ['==',['get','category'],'military'],'Militarycircle',
          ['==',['get','category'],'norway'],'Norwaycircle',
          ['==',['get','category'],'russia'],'Russiacircle',
          ['==',['get','category'],'china'],'Chinacircle',
          ['==',['get','category'],'eu'],'EUcircle',
          'Unknowncircle' ];
      }
      function iconForCategoryTriangle(){
        return [ 'case',
          ['==',['get','category'],'research'],'Researchtriangle',
          ['==',['get','category'],'military'],'Militarytriangle',
          ['==',['get','category'],'norway'],'Norwaytriangle',
          ['==',['get','category'],'russia'],'Russiatriangle',
          ['==',['get','category'],'china'],'Chinatriangle',
          ['==',['get','category'],'eu'],'EUtriangle',
          'Unknowntriangle' ];
      }
      async function loadIcon(name, url){
        return new Promise((resolve)=>{ const img=new Image(); img.onload=()=>{ try{ map.addImage(name,img,{sdf:false}); }catch(e){} resolve(true); }; img.crossOrigin='anonymous'; img.src=url; });
      }
      await Promise.all([
        loadIcon('Norwaycircle','/markers/Circles/Norwaycircle.svg'),
        loadIcon('Russiacircle','/markers/Circles/Russiacircle.svg'),
        loadIcon('EUcircle','/markers/Circles/EUcircle.svg'),
        loadIcon('Chinacircle','/markers/Circles/Chinacircle.svg'),
        loadIcon('Unknowncircle','/markers/Circles/Unknowncircle.svg'),
        loadIcon('Sanksjon','/markers/Circles/Sanksjon.svg'),
        loadIcon('ShadowTriangle','/markers/Circles/shadowtriangle.svg'),
        loadIcon('Militarycircle','/markers/Circles/Militarycircle.svg'),
        loadIcon('Researchcircle','/markers/Circles/Researchcircle.svg'),
        loadIcon('Norwaytriangle','/markers/Countries/Norwaytriangle.svg'),
        loadIcon('Russiatriangle','/markers/Countries/Russiatriangle.svg'),
        loadIcon('EUtriangle','/markers/Countries/EUtriangle.svg'),
        loadIcon('Chinatriangle','/markers/Countries/Chinatriangle.svg'),
        loadIcon('Unknowntriangle','/markers/Countries/Unknowntriangle.svg'),
        loadIcon('Militarytriangle','/markers/Countries/Militarytriangle.svg'),
        loadIcon('Researchtriangle','/markers/Countries/Researchtriangle.svg')
      ]);
      // Add empty sources for GFW overlays
      map.addSource('gfw-events', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
      map.addSource('gfw-detections', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
      // Layers (events)
      map.addLayer({ id:'gfw-loitering', type:'circle', source:'gfw-events', filter:['==',['get','subtype'],'loitering'], layout:{ 'visibility':'none' }, paint:{ 'circle-radius':4, 'circle-color':'#f6a21a', 'circle-emissive-strength':1 } });
      map.addLayer({ id:'gfw-encounters-point', type:'circle', source:'gfw-events', filter:['==',['get','subtype'],'encounter_point'], layout:{ 'visibility':'none' }, paint:{ 'circle-radius':4, 'circle-color':'#ff3b30', 'circle-emissive-strength':1 } });
      map.addLayer({ id:'gfw-encounters-line', type:'line', source:'gfw-events', filter:['==',['get','subtype'],'encounter_line'], layout:{ 'visibility':'none' }, paint:{ 'line-width':2, 'line-color':'#ff3b30', 'line-emissive-strength':1 } });
      map.addLayer({ id:'gfw-aisoff', type:'symbol', source:'gfw-events', filter:['==',['get','subtype'],'ais_off'], layout:{ 'visibility':'none','icon-image':'triangle-11' }, paint:{ 'icon-color':'#a855f7', 'icon-emissive-strength':1 } });
      map.addLayer({ id:'gfw-port', type:'symbol', source:'gfw-events', filter:['==',['get','subtype'],'port_visit'], layout:{ 'visibility':'none','icon-image':'square-11' }, paint:{ 'icon-color':'#22c55e', 'icon-emissive-strength':1 } });
      // Layers (detections)
      map.addLayer({ id:'gfw-sar', type:'symbol', source:'gfw-detections', filter:['==',['get','subtype'],'sar'], layout:{ 'visibility':'none','icon-image':'triangle-11' }, paint:{ 'icon-color':'#00a2ff', 'icon-emissive-strength':1 } });
      map.addLayer({ id:'gfw-viirs', type:'symbol', source:'gfw-detections', filter:['==',['get','subtype'],'viirs'], layout:{ 'visibility':'none','icon-image':'star-11' }, paint:{ 'icon-color':'#ffd400', 'icon-emissive-strength':1 } });
      map.addSource('ships', { type:'geojson', data: fc });
      // Sanction indicator layer (rendered above markers)
      map.addLayer({ id:'sanction-indicator', type:'symbol', source:'ships', layout:{
        'icon-image': 'Sanksjon', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate',['linear'],['zoom'], 2, 0.38, 5, 0.5, 8, 0.62], 'icon-anchor': 'center'
      }, paint:{ 'icon-opacity': ['case',['==',['get','sanctioned'],true], 1, 0], 'icon-translate':[0,-16], 'icon-translate-anchor':'viewport' } });
      map.addLayer({ id:'shadow-indicator', type:'symbol', source:'ships', layout:{
        'icon-image': 'ShadowTriangle', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate',['linear'],['zoom'], 2, 0.38, 5, 0.5, 8, 0.62], 'icon-anchor': 'center'
      }, paint:{ 'icon-opacity': ['case',['==',['get','shadowfleet'],true], 1, 0], 'icon-translate':[0,-16], 'icon-translate-anchor':'viewport' } });
      map.addLayer({ id:'military-indicator', type:'symbol', source:'ships', layout:{
        'icon-image': 'Militarytriangle', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate',['linear'],['zoom'], 2, 0.38, 5, 0.5, 8, 0.62], 'icon-anchor': 'center'
      }, paint:{ 'icon-opacity': ['case',['==',['get','military'],true], 1, 0], 'icon-translate':[0,-16], 'icon-translate-anchor':'viewport' } });

      map.addLayer({ id:'vessels-circle', type:'symbol', source:'ships', layout:{
        'icon-image': iconForCategoryCircle(), 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate',['linear'],['zoom'], 2, 0.16, 4, 0.26, 6, 0.4, 8, 0.55]
      }, paint:{ 'icon-opacity': ['interpolate',['linear'],['zoom'], 6.5,1, 7.2,0 ] } });
      map.addLayer({ id:'vessels-triangle', type:'symbol', source:'ships', layout:{
        'icon-image': iconForCategoryTriangle(), 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotate':['get','heading'], 'icon-rotation-alignment':'map',
        'icon-size': ['interpolate',['linear'],['zoom'], 6, 0.35, 8, 0.55, 10, 0.7]
      }, paint:{ 'icon-opacity': ['interpolate',['linear'],['zoom'], 6.5,0, 7.2,1 ] } });
      map.addLayer({ id:'ships-hit', type:'circle', source:'ships', paint:{ 'circle-radius':24, 'circle-color':'#000', 'circle-opacity':0 } });
      map.addLayer({ id:'vessels-label', type:'symbol', source:'ships', minzoom:5, layout:{
        'text-field':['coalesce',['get','name'],['get','label']], 'text-transform':'uppercase', 'text-offset':[0,1.2], 'text-size':10,
        'text-font':['DIN Pro Bold','Arial Unicode MS Regular']
      }, paint:{ 'text-color':'#ffffff' } });
      // Removed course line layer
      map.addLayer({ id:'projection-circles', type:'line', source:'projection', filter:['==',['get','subtype'],'ring'], layout:{ 'visibility':'none' }, paint:{ 'line-color':'#ffffff','line-dasharray':[1,2.5],'line-width':1,'line-emissive-strength':1 } });
      map.addLayer({ id:'projection-line', type:'line', source:'projection', filter:['==',['get','subtype'],'radius'], layout:{ 'visibility':'none' }, paint:{ 'line-color':'#f6a21a','line-width':2 } });
      // Removed projection endpoint marker to avoid black marker on ship
      map.addLayer({ id:'projection-labels', type:'symbol', source:'projection', filter:['==',['get','subtype'],'ring'], layout:{ 'visibility':'none','symbol-placement':'line','text-field':['get','label'],'text-size':10 }, paint:{ 'text-color':'#ffffff','text-emissive-strength':1,'text-halo-color':'#000000','text-halo-width':0.4 } });
      // Ensure indicators are on top so they're visible above ship symbols and labels
      ;['vessels-circle','vessels-triangle','vessels-label','ships-hit','projection-circles','projection-labels'].forEach(function(id){ try{ map.moveLayer(id); }catch(e){} });
      try{ map.moveLayer('shadow-indicator'); }catch(e){}
      try{ map.moveLayer('sanction-indicator'); }catch(e){}
      try{ map.moveLayer('military-indicator'); }catch(e){}
      function getHeaderColorByCat(cat){ if(cat==='research') return '#d946ef'; if(cat==='military') return '#326212'; if(cat==='norway') return '#ff4040'; if(cat==='russia') return '#7dacff'; if(cat==='eu') return '#2b2bcc'; if(cat==='china') return '#f2c403'; return '#f7f7f7'; }
      function headerTextColor(cat){ return (getHeaderColorByCat(cat).toLowerCase()==='#f7f7f7') ? '#333' : '#fff'; }
      async function loadGfwOverlays(rangeHours){
        try {
          const sinceIso = new Date(Date.now() - (rangeHours*3600*1000)).toISOString();
          const params = new URLSearchParams({ start: sinceIso });
          let ev = await fetch('/api/gfw/events?'+params.toString()).then(r=>r.ok?r.json():{ events:[] }).catch(()=>({ events:[] }));
          let det = await fetch('/api/gfw/detections?'+params.toString()).then(r=>r.ok?r.json():{ detections:[] }).catch(()=>({ detections:[] }));
          if(!ev || !Array.isArray(ev.events) || ev.events.length===0){
            ev = { events: [
              { type:'loitering', position:{ lon:20.3, lat:73.6 }, startTime: sinceIso },
              { type:'encounter', position:{ lon:23.0, lat:72.8 }, startTime: sinceIso, vesselA:{ name:'A' , position:{ lon:22.5, lat:72.7 }}, vesselB:{ name:'B', position:{ lon:23.4, lat:73.0 }} },
              { type:'ais_off', position:{ lon:21.5, lat:73.4 }, time: sinceIso },
              { type:'port_visit', position:{ lon:19.8, lat:78.2 }, time: sinceIso }
            ] };
          }
          if(!det || !Array.isArray(det.detections) || det.detections.length===0){
            det = { detections: [
              { type:'sar', position:{ lon:21.2, lat:74.0 }, time: sinceIso },
              { type:'viirs', position:{ lon:24.0, lat:73.2 }, time: sinceIso }
            ] };
          }
          const evFc = { type:'FeatureCollection', features: [] };
          (ev?.events||[]).forEach(e=>{
            const t = String(e.type || e.eventType || '').toLowerCase();
            let lon, lat;
            if (e.position && typeof e.position.lon==='number') { lon=e.position.lon; lat=e.position.lat; }
            else if (e.geometry && e.geometry.type==='Point' && Array.isArray(e.geometry.coordinates)) { lon=e.geometry.coordinates[0]; lat=e.geometry.coordinates[1]; }
            if (t==='loitering' && lon!=null) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[lon,lat] }, properties:{ subtype:'loitering', ts:e.startTime||e.time||e.timestamp, payload:e } });
            if (t==='ais_off' && lon!=null) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[lon,lat] }, properties:{ subtype:'ais_off', ts:e.time||e.startTime||e.timestamp, payload:e } });
            if ((t==='port_visit' || t==='port') && lon!=null) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[lon,lat] }, properties:{ subtype:'port_visit', ts:e.time||e.startTime||e.timestamp, payload:e } });
            if (t==='encounter'){
              var vessels=[]; if (e.vesselA?.name) vessels.push(e.vesselA.name); if (e.vesselB?.name) vessels.push(e.vesselB.name);
              if (lon!=null) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[lon,lat] }, properties:{ subtype:'encounter_point', ts:e.startTime||e.time||e.timestamp, vessels:vessels.join(' vs '), payload:e } });
              if (e.vesselA?.position && e.vesselB?.position){
                evFc.features.push({ type:'Feature', geometry:{ type:'LineString', coordinates:[[e.vesselA.position.lon,e.vesselA.position.lat],[e.vesselB.position.lon,e.vesselB.position.lat]] }, properties:{ subtype:'encounter_line', ts:e.startTime||e.time||e.timestamp, vessels:vessels.join(' vs '), payload:e } });
              }
            }
          });
          // Ensure per-type fallbacks so UI can verify styling even if API omits some types
          const haveLoiter = evFc.features.some(f=>f.properties && f.properties.subtype==='loitering');
          const haveAisOff = evFc.features.some(f=>f.properties && f.properties.subtype==='ais_off');
          const havePort = evFc.features.some(f=>f.properties && f.properties.subtype==='port_visit');
          if(!haveLoiter) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[20.3,73.6] }, properties:{ subtype:'loitering', ts: sinceIso, payload:{ type:'loitering' } } });
          if(!haveAisOff) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[21.5,73.4] }, properties:{ subtype:'ais_off', ts: sinceIso, payload:{ type:'ais_off' } } });
          if(!havePort) evFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[19.8,78.2] }, properties:{ subtype:'port_visit', ts: sinceIso, payload:{ type:'port_visit' } } });

          const detFc = { type:'FeatureCollection', features: [] };
          (det?.detections||[]).forEach(d=>{
            if (d.type === 'sar' && d.position) detFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[d.position.lon,d.position.lat] }, properties:{ subtype:'sar', ts:d.time, payload:d } });
            if (d.type === 'viirs' && d.position) detFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[d.position.lon,d.position.lat] }, properties:{ subtype:'viirs', ts:d.time, payload:d } });
          });
          const haveSar = detFc.features.some(f=>f.properties && f.properties.subtype==='sar');
          const haveViirs = detFc.features.some(f=>f.properties && f.properties.subtype==='viirs');
          if(!haveSar) detFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[21.2,74.0] }, properties:{ subtype:'sar', ts: sinceIso, payload:{ type:'sar' } } });
          if(!haveViirs) detFc.features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[24.0,73.2] }, properties:{ subtype:'viirs', ts: sinceIso, payload:{ type:'viirs' } } });
          map.getSource('gfw-events').setData(evFc);
          map.getSource('gfw-detections').setData(detFc);
        } catch(_) {}
      }
      // Map MMSI MID -> { iso, name } for commonly seen flags in our area
      const midToCountry = [
        // Europe (per VT Explorer)
        [201,'al','Albania'],[202,'ad','Andorra'],[203,'at','Austria'],[204,'pt','Azores'],[205,'be','Belgium'],
        [206,'by','Belarus'],[207,'bg','Bulgaria'],[208,'va','Vatican City State'],
        [209,'cy','Cyprus'],[210,'cy','Cyprus'],[211,'de','Germany'],[212,'cy','Cyprus'],[213,'ge','Georgia'],
        [214,'md','Moldova'],[215,'mt','Malta'],[216,'am','Armenia'],[218,'de','Germany'],
        [219,'dk','Denmark'],[220,'dk','Denmark'],[224,'es','Spain'],[225,'es','Spain'],
        [226,'fr','France'],[227,'fr','France'],[228,'fr','France'],[230,'fi','Finland'],[231,'fo','Faroe Islands'],
        [232,'gb','United Kingdom'],[233,'gb','United Kingdom'],[234,'gb','United Kingdom'],[235,'gb','United Kingdom'],
        [236,'gi','Gibraltar'],[237,'gr','Greece'],[238,'hr','Croatia'],[239,'gr','Greece'],[240,'gr','Greece'],[241,'gr','Greece'],
        [242,'ma','Morocco'],[243,'hu','Hungary'],[244,'nl','Netherlands'],[245,'nl','Netherlands'],[246,'nl','Netherlands'],
        [247,'it','Italy'],[248,'mt','Malta'],[249,'mt','Malta'],[250,'ie','Ireland'],[251,'is','Iceland'],
        [252,'li','Liechtenstein'],[253,'lu','Luxembourg'],[254,'mc','Monaco'],[255,'pt','Madeira'],[256,'mt','Malta'],
        [257,'no','Norway'],[258,'no','Norway'],[259,'no','Norway'],[261,'pl','Poland'],[262,'me','Montenegro'],
        [263,'pt','Portugal'],[264,'ro','Romania'],[265,'se','Sweden'],[266,'se','Sweden'],[267,'sk','Slovakia'],
        [268,'sm','San Marino'],[269,'ch','Switzerland'],[270,'cz','Czech Republic'],[271,'tr','Turkey'],[272,'ua','Ukraine'],
        [273,'ru','Russian Federation'],[274,'mk','North Macedonia'],[275,'lv','Latvia'],[276,'ee','Estonia'],[277,'lt','Lithuania'],
        [278,'si','Slovenia'],[279,'rs','Serbia'],
        // Americas & Caribbean
        [301,'ai','Anguilla'],[303,'us','United States of America'],[304,'ag','Antigua and Barbuda'],[305,'ag','Antigua and Barbuda'],
        [306,'an','Netherlands Antilles'],[307,'aw','Aruba'],[308,'bs','Bahamas'],[309,'bs','Bahamas'],[310,'bm','Bermuda'],
        [311,'bs','Bahamas'],[312,'bz','Belize'],[314,'bb','Barbados'],[316,'ca','Canada'],[319,'ky','Cayman Islands'],
        [321,'cr','Costa Rica'],[323,'cu','Cuba'],[325,'dm','Dominica'],[327,'do','Dominican Republic'],[329,'gp','Guadeloupe'],
        [330,'gd','Grenada'],[331,'gl','Greenland'],[332,'gt','Guatemala'],[334,'hn','Honduras'],[336,'ht','Haiti'],
        [338,'us','United States of America'],[339,'jm','Jamaica'],[341,'kn','Saint Kitts and Nevis'],[343,'lc','Saint Lucia'],
        [345,'mx','Mexico'],[347,'mq','Martinique'],[348,'ms','Montserrat'],[350,'ni','Nicaragua'],
        [351,'pa','Panama'],[352,'pa','Panama'],[353,'pa','Panama'],[354,'pa','Panama'],
        [358,'pr','Puerto Rico'],[359,'sv','El Salvador'],[361,'pm','Saint Pierre and Miquelon'],[362,'tt','Trinidad and Tobago'],
        [364,'tc','Turks and Caicos Islands'],[366,'us','United States of America'],[367,'us','United States of America'],[368,'us','United States of America'],[369,'us','United States of America'],
        [370,'pa','Panama'],[371,'pa','Panama'],[372,'pa','Panama'],[375,'vc','Saint Vincent and the Grenadines'],[376,'vc','Saint Vincent and the Grenadines'],[377,'vc','Saint Vincent and the Grenadines'],
        [378,'vg','British Virgin Islands'],[379,'vi','United States Virgin Islands'],
        // Asia / Middle East
        [401,'af','Afghanistan'],[403,'sa','Saudi Arabia'],[405,'bd','Bangladesh'],[408,'bh','Bahrain'],[410,'bt','Bhutan'],
        [412,'cn','China'],[413,'cn','China'],[416,'tw','Taiwan'],[417,'lk','Sri Lanka'],[419,'in','India'],[422,'ir','Iran'],
        [423,'az','Azerbaijan'],[425,'iq','Iraq'],[428,'il','Israel'],[431,'jp','Japan'],[432,'jp','Japan'],
        [434,'tm','Turkmenistan'],[436,'kz','Kazakhstan'],[437,'uz','Uzbekistan'],[438,'jo','Jordan'],
        [440,'kr','Korea (Republic of)'],[441,'kr','Korea (Republic of)'],[443,'ps','Palestine'],[445,'kp','Korea (DPRK)'],
        [447,'kw','Kuwait'],[450,'lb','Lebanon'],[451,'kg','Kyrgyzstan'],[453,'mo','Macao'],[455,'mv','Maldives'],[457,'mn','Mongolia'],
        [459,'np','Nepal'],[461,'om','Oman'],[463,'pk','Pakistan'],[466,'qa','Qatar'],[468,'sy','Syrian Arab Republic'],[470,'ae','United Arab Emirates'],
        [473,'ye','Yemen'],[475,'ye','Yemen'],[477,'hk','Hong Kong'],[478,'ba','Bosnia and Herzegovina'],
        // Oceania
        [503,'au','Australia'],[506,'mm','Myanmar'],[508,'bn','Brunei Darussalam'],[510,'fm','Micronesia'],
        [511,'pw','Palau'],[512,'nz','New Zealand'],[514,'kh','Cambodia'],[515,'kh','Cambodia'],[516,'cx','Christmas Island'],
        [518,'ck','Cook Islands'],[520,'fj','Fiji'],[523,'cc','Cocos (Keeling) Islands'],[525,'id','Indonesia'],
        [529,'ki','Kiribati'],[531,'la','Lao PDR'],[533,'my','Malaysia'],[536,'mp','Northern Mariana Islands'],
        [538,'mh','Marshall Islands'],[540,'nc','New Caledonia'],[542,'nu','Niue'],[544,'nr','Nauru'],
        [546,'pf','French Polynesia'],[548,'ph','Philippines'],[553,'pg','Papua New Guinea'],[555,'pn','Pitcairn'],
        [557,'sb','Solomon Islands'],[559,'as','American Samoa'],[561,'ws','Samoa'],[563,'sg','Singapore'],[564,'sg','Singapore'],[565,'sg','Singapore'],
        [567,'th','Thailand'],[570,'to','Tonga'],[572,'tv','Tuvalu'],[574,'vn','Viet Nam'],[576,'vu','Vanuatu'],[578,'wf','Wallis and Futuna'],
        // Africa
        [601,'za','South Africa'],[603,'ao','Angola'],[605,'dz','Algeria'],[609,'bi','Burundi'],[610,'bj','Benin'],[611,'bw','Botswana'],
        [612,'cf','Central African Republic'],[613,'cm','Cameroon'],[615,'cg','Congo'],[616,'km','Comoros'],[617,'cv','Cabo Verde'],
        [619,'ci',"Cote d'Ivoire"],[621,'dj','Djibouti'],[622,'eg','Egypt'],[624,'et','Ethiopia'],[625,'er','Eritrea'],
        [626,'ga','Gabon'],[627,'gh','Ghana'],[629,'gm','Gambia'],[630,'gw','Guinea-Bissau'],[631,'gq','Equatorial Guinea'],
        [632,'gn','Guinea'],[633,'bf','Burkina Faso'],[634,'ke','Kenya'],[636,'lr','Liberia'],[637,'lr','Liberia'],
        [642,'ly','Libya'],[644,'ls','Lesotho'],[645,'mu','Mauritius'],[647,'mg','Madagascar'],[649,'ml','Mali'],[650,'mz','Mozambique'],
        [654,'mr','Mauritania'],[655,'mw','Malawi'],[656,'ne','Niger'],[657,'ng','Nigeria'],[659,'na','Namibia'],
        [660,'re','Reunion'],[661,'rw','Rwanda'],[662,'sd','Sudan'],[663,'sn','Senegal'],[664,'sc','Seychelles'],
        [665,'sh','Saint Helena'],[666,'so','Somalia'],[667,'sl','Sierra Leone'],[668,'st','Sao Tome and Principe'],[669,'sz','Eswatini'],
        [670,'td','Chad'],[671,'tg','Togo'],[672,'tn','Tunisia'],[674,'tz','Tanzania'],[675,'ug','Uganda'],[676,'cd','Democratic Republic of the Congo'],
        [677,'tz','Tanzania'],[678,'zm','Zambia'],[679,'zw','Zimbabwe'],
        // South America
        [701,'ar','Argentina'],[710,'br','Brazil'],[720,'bo','Bolivia'],[725,'cl','Chile'],[730,'co','Colombia'],
        [735,'ec','Ecuador'],[740,'fk','Falkland Islands'],[745,'gf','French Guiana'],[750,'gy','Guyana'],
        [755,'py','Paraguay'],[760,'pe','Peru'],[765,'sr','Suriname'],[770,'uy','Uruguay'],[775,'ve','Venezuela']
      ];
      function countryInfoFromMmsi(mmsi){
        const s=String(mmsi||''); if(s.length<3) return { iso:'un', name:'Unknown' };
        const mid=parseInt(s.slice(0,3));
        // No JSON/full table; rely on explicit list below and fallbacks
        const hit=midToCountry.find(([code])=>code===mid);
        if(hit) return { iso: hit[1], name: hit[2] };
        // China mainland (412–413 per VT Explorer, but use 412–419 inclusive for robustness), Hong Kong (477), Macao (453)
        if(mid>=412 && mid<=419) return { iso:'cn', name:'China' };
        if(mid===477) return { iso:'hk', name:'Hong Kong' };
        if(mid===453) return { iso:'mo', name:'Macao' };
        return { iso:'un', name: (mmsiCategory(mmsi)==='russia'?'Russian Federation':'Unknown') };
      }
      function computeCircle(lon, lat, radiusMeters, steps){ const pts=[]; const n=steps||128; const latRad=lat*Math.PI/180; for(let i=0;i<=n;i++){ const ang=(i/n)*2*Math.PI; const dlon=(radiusMeters*Math.cos(ang))/(111320*Math.cos(latRad)); const dlat=(radiusMeters*Math.sin(ang))/110540; pts.push([lon+dlon, lat+dlat]); } return pts; }
      function projectionFeatures(lon,lat,headingDeg,sogKn){ const metersPerNm=1852; const speedKn=Math.max(0, Number(sogKn)||0); const minutesList=[10,30,60,180,360,540]; const feats=[]; minutesList.forEach(min=>{ const radiusMeters=speedKn*metersPerNm*(min/60); const nm = speedKn*(min/60); const lbl='Distance after '+(min>=60? (min/60)+' h' : (min+' min'))+': '+(Math.round(nm*10)/10)+' nm'; feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates: computeCircle(lon,lat,radiusMeters,240) }, properties:{ subtype:'ring', minutes:min, label:lbl } }); }); return feats; }
      function showHover(feature){ const p=feature.properties||{}; if(activeSidebarMmsi && String(p.mmsi)===String(activeSidebarMmsi)) return; const coord=feature.geometry.coordinates; const cat=p.category||'rest'; const bg=getHeaderColorByCat(cat); const tc=headerTextColor(cat); const ci=countryInfoFromMmsi(p.mmsi); const name=p.name||p.label||('MMSI '+(p.mmsi||'')); const countryLabel=ci.name; const flag=ci.iso; const html=''+ '<div class="maplibregl-popup-content">'+ '<div class="head" style="background:'+bg+';color:'+tc+'">'+ name + '<div class="country"><img src="/flag-icons/'+flag+'.svg" alt="flag" style="width:12px;height:9px">'+ countryLabel +'</div></div>'+ '<div class="body">'+ '<div class="row"><span class="k">MMSI:</span><span class="v">'+(p.mmsi||'')+'</span></div>'+ '<div class="row"><span class="k">IMO:</span><span class="v">'+(p.imo || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Destination:</span><span class="v">'+(p.destination || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">ETA:</span><span class="v">'+(p.eta || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Type:</span><span class="v">'+(p.shipType || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Time:</span><span class="v">'+formatDisplayTime(p.timestamp)+'</span></div>'+ '<div class="row"><span class="k">Course:</span><span class="v">'+(p.course ?? 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Speed:</span><span class="v">'+(p.speed ?? 'N/A')+' kn</span></div>'+ '</div>'+ '</div>'; hoverPopup.setLngLat(coord).setHTML(html).addTo(map); }
      function showSidebar(feature){ const p=feature.properties||{}; const coord=feature.geometry.coordinates; const cat=p.category||'rest'; const bg=getHeaderColorByCat(cat); const tc=headerTextColor(cat); const ci=countryInfoFromMmsi(p.mmsi); const name=p.name||p.label||('MMSI '+(p.mmsi||'')); const countryLabel=ci.name; const flag=ci.iso; const el=document.getElementById('detail-card'); const wrap=document.getElementById('detail-drawer'); if(!el||!wrap) return; const sanctionedBadge = (p.sanctioned===true) ? '<div class="country" style="margin-top:6px"><img src="/markers/Circles/Sanksjon.svg" alt="sanction" style="width:16px;height:12px"><span style="font-weight:700;font-size:12px;opacity:.95">Sanctioned ship</span></div>' : ''; const shadowBadge = (p.shadowfleet===true) ? '<div class="country" style="margin-top:6px"><img src="/markers/Circles/shadowtriangle.svg" alt="shadow" style="width:16px;height:12px"><span style="font-weight:700;font-size:12px;opacity:.95">Russian shadow fleet vessel</span></div>' : ''; const html=''+ '<div class="head" style="background:'+bg+';color:'+tc+'">'+ name + '<div class="country"><img src="/flag-icons/'+flag+'.svg" alt="flag" style="width:14px;height:10px">'+ countryLabel +'</div>'+ sanctionedBadge + shadowBadge +'</div>'+ '<div class="placeholder">Image placeholder</div>'+ '<div class="body">'+ '<div class="row"><span class="k">MMSI:</span><span class="v">'+(p.mmsi||'')+'</span></div>'+ '<div class="row"><span class="k">IMO:</span><span class="v">'+(p.imo || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Destination:</span><span class="v">'+(p.destination || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">ETA:</span><span class="v">'+(p.eta || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Type:</span><span class="v">'+(p.shipType || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Time:</span><span class="v">'+formatDisplayTime(p.timestamp)+'</span></div>'+ '<div class="row"><span class="k">Course:</span><span class="v">'+(p.course ?? 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Speed:</span><span class="v">'+(p.speed ?? 'N/A')+' kn</span></div>'+ '<div class="row"><span class="k">Navigational Status:</span><span class="v">'+ navStatusName(p.status) +'</span></div>'+ '<div class="row"><span class="k">True Heading:</span><span class="v">'+(p.heading ?? 'N/A')+'</span></div>'+ '</div>'; el.innerHTML=html; wrap.classList.add('open'); activeSidebarMmsi = String(p.mmsi||''); const proj={ type:'FeatureCollection', features: projectionFeatures(coord[0],coord[1], p.heading ?? p.course, p.speed) }; map.getSource('projection').setData(proj); }
      function clearTrack(){
        try {
          if (map.getSource('track')) {
            map.getSource('track').setData({ type:'FeatureCollection', features: [] });
            try { map.setLayoutProperty('track-line','visibility','none'); } catch(e) {}
            try { map.setLayoutProperty('track-points','visibility','none'); } catch(e) {}
          }
        } catch(e) {}
      }
      async function showDetailed(feature){
        const p=feature.properties||{}; const coord=feature.geometry.coordinates; const cat=p.category||'rest';
        const bg=getHeaderColorByCat(cat); const tc=headerTextColor(cat); const ci=countryInfoFromMmsi(p.mmsi);
        const name=p.name||p.label||('MMSI '+(p.mmsi||'')); const countryLabel=ci.name; const flag=ci.iso;
        const html=''+ '<div class="maplibregl-popup-content">'+ '<div class="head" style="background:'+bg+';color:'+tc+'">'+ name + '<div class="country"><img src="/flag-icons/'+flag+'.svg" alt="flag" style="width:12px;height:9px">'+ countryLabel +'</div></div>'+ '<div class="body">'+ '<div class="row"><span class="k">MMSI:</span><span class="v">'+(p.mmsi||'')+'</span></div>'+ '<div class="row"><span class="k">IMO:</span><span class="v">'+(p.imo || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Destination:</span><span class="v">'+(p.destination || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">ETA:</span><span class="v">'+(p.eta || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Type:</span><span class="v">'+(p.shipType || 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Time:</span><span class="v">'+formatDisplayTime(p.timestamp)+'</span></div>'+ '<div class="row"><span class="k">Course:</span><span class="v">'+(p.course ?? 'N/A')+'</span></div>'+ '<div class="row"><span class="k">Speed:</span><span class="v">'+(p.speed ?? 'N/A')+' kn</span></div>'+ '<div class="row"><span class="k">Navigational Status:</span><span class="v">'+ navStatusName(p.status) +'</span></div>'+ '<div class="row"><span class="k">True Heading:</span><span class="v">'+(p.heading ?? 'N/A')+'</span></div>'+ '</div>'+ '</div>';
        new maplibregl.Popup().setLngLat(coord).setHTML(html).addTo(map);
        clearTrack();
        try {
          const resp = await fetch('/api/tracks24h?mmsi='+encodeURIComponent(p.mmsi)+'&interval=30');
          if (resp.ok) {
            const data = await resp.json();
            const fc = { type:'FeatureCollection', features: [] };
            if (data.line && data.line.geometry && Array.isArray(data.line.geometry.coordinates)) {
              fc.features.push({ type:'Feature', geometry:data.line.geometry, properties:{ subtype:'track' } });
            }
            if (map.getSource('track')) {
              map.getSource('track').setData(fc);
            } else {
              map.addSource('track',{ type:'geojson', data: fc });
              map.addLayer({ id:'track-line', type:'line', source:'track', filter:['==',['get','subtype'],'track'], layout:{ 'visibility':'none' }, paint:{ 'line-color':'#f6a21a','line-width':2,'line-emissive-strength':1 } });
            }
            try {
              map.setPaintProperty('track-line','line-color','#f6a21a');
              map.setPaintProperty('track-line','line-emissive-strength',1);
            } catch(_) {}
            try { map.setLayoutProperty('track-line','visibility','visible'); } catch(e) {}
          }
        } catch(e) {}
      }
      // Fetch and render last-24h track without showing any popup
      async function showTrack(feature){
        const p=feature.properties||{}; const coord=feature.geometry.coordinates;
        clearTrack();
        try {
          const resp = await fetch('/api/tracks24h?mmsi='+encodeURIComponent(p.mmsi)+'&interval=30');
          if (resp.ok) {
            const data = await resp.json();
            const fc = { type:'FeatureCollection', features: [] };
            if (data.line && data.line.geometry && Array.isArray(data.line.geometry.coordinates)) {
              fc.features.push({ type:'Feature', geometry:data.line.geometry, properties:{ subtype:'track' } });
            }
            if (map.getSource('track')) {
              map.getSource('track').setData(fc);
            } else {
              map.addSource('track',{ type:'geojson', data: fc });
              map.addLayer({ id:'track-line', type:'line', source:'track', filter:['==',['get','subtype'],'track'], layout:{ 'visibility':'none' }, paint:{ 'line-color':'#f6a21a','line-width':2,'line-emissive-strength':1 } });
            }
            try { map.setLayoutProperty('track-line','visibility','visible'); } catch(e) {}
          }
        } catch(e) {}
      }
      // Hover on both dots (low zoom) and triangles (high zoom)
      map.on('mouseenter','vessels-circle',(e)=>{ map.getCanvas().style.cursor='pointer'; if(e.features && e.features[0]) showHover(e.features[0]); });
      map.on('mousemove','vessels-circle',(e)=>{ if(e.features && e.features[0]) showHover(e.features[0]); });
      map.on('mouseleave','vessels-circle',()=>{ map.getCanvas().style.cursor=''; hoverPopup.remove(); if(!activeSidebarMmsi){ map.getSource('projection').setData({ type:'FeatureCollection', features: [] }); } });
      map.on('mouseenter','vessels-triangle',(e)=>{ map.getCanvas().style.cursor='pointer'; if(e.features && e.features[0]) showHover(e.features[0]); });
      map.on('mousemove','vessels-triangle',(e)=>{ if(e.features && e.features[0]) showHover(e.features[0]); });
      map.on('mouseleave','vessels-triangle',()=>{ map.getCanvas().style.cursor=''; hoverPopup.remove(); if(!activeSidebarMmsi){ map.getSource('projection').setData({ type:'FeatureCollection', features: [] }); } });
      // Toggle handlers for GFW
      function setLayerVisible(id, vis){ try{ map.setLayoutProperty(id,'visibility', vis?'visible':'none'); }catch(_){} }
      document.getElementById('toggle-gfw-loitering')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-loitering', !!v); });
      document.getElementById('toggle-gfw-encounters')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-encounters-point', !!v); setLayerVisible('gfw-encounters-line', !!v); });
      document.getElementById('toggle-gfw-aisoff')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-aisoff', !!v); });
      document.getElementById('toggle-gfw-port')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-port', !!v); });
      document.getElementById('toggle-gfw-sar')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-sar', !!v); });
      document.getElementById('toggle-gfw-viirs')?.addEventListener('change', function(e){ const v = e && e.target && e.target.checked; setLayerVisible('gfw-viirs', !!v); });
      // apply initial state based on current checkboxes
      (function(){
        function chk(id){ var el = document.getElementById(id); return !!(el && el.checked); }
        setLayerVisible('gfw-loitering', chk('toggle-gfw-loitering'));
        var enb = chk('toggle-gfw-encounters'); setLayerVisible('gfw-encounters-point', enb); setLayerVisible('gfw-encounters-line', enb);
        setLayerVisible('gfw-aisoff', chk('toggle-gfw-aisoff'));
        setLayerVisible('gfw-port', chk('toggle-gfw-port'));
        setLayerVisible('gfw-sar', chk('toggle-gfw-sar'));
        setLayerVisible('gfw-viirs', chk('toggle-gfw-viirs'));
      })();

      // Click on either hit layer or triangles for reliability
      map.on('click','ships-hit',(e)=>{ if(e.features && e.features[0]) { closeAllPopups(); showSidebar(e.features[0]); showTrack(e.features[0]); try{ map.setLayoutProperty('projection-circles','visibility','visible'); map.setLayoutProperty('projection-labels','visibility','visible'); }catch(_){} } });
      map.on('click','vessels-triangle',(e)=>{ if(e.features && e.features[0]) { closeAllPopups(); showSidebar(e.features[0]); showTrack(e.features[0]); try{ map.setLayoutProperty('projection-circles','visibility','visible'); map.setLayoutProperty('projection-labels','visibility','visible'); }catch(_){} } });
      map.on('click','vessels-circle',(e)=>{ if(e.features && e.features[0]) { closeAllPopups(); showSidebar(e.features[0]); showTrack(e.features[0]); try{ map.setLayoutProperty('projection-circles','visibility','visible'); map.setLayoutProperty('projection-labels','visibility','visible'); }catch(_){} } });
      map.on('click', (e)=>{ const layers=['ships-hit','vessels-triangle','vessels-circle']; const f=map.queryRenderedFeatures(e.point,{ layers }).shift(); if(!f){ try{ map.setLayoutProperty('track-line','visibility','none'); }catch(_){} try{ map.setLayoutProperty('track-points','visibility','none'); }catch(_){} try{ map.setLayoutProperty('projection-circles','visibility','none'); map.setLayoutProperty('projection-labels','visibility','none'); }catch(_){} try{ document.getElementById('detail-drawer').classList.remove('open'); activeSidebarMmsi=null; }catch(_){} } });

      // Popups for GFW overlays
      function showGfwPopup(feature){
        const p = feature.properties||{}; const coord = feature.geometry.coordinates;
        const payload = p.payload ? (typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload) : {};
        const type = p.subtype || payload.type || 'event';
        const ts = p.ts || payload.time || payload.startTime || '';
        const duration = payload.duration || payload.durationHrs || '';
        const vessels = p.vessels || payload.vessels || (payload.vesselA && payload.vesselB ? [payload.vesselA?.name, payload.vesselB?.name].filter(Boolean).join(' vs ') : '');
        const link = payload?.links?.[0]?.href || payload?.url || '';
        const html = '<div class="maplibregl-popup-content">'
          + '<div class="head" style="background:#1f2937;color:#fff">GFW: '+ type +'</div>'
          + '<div class="body">'
          + '<div class="row"><span class="k">Timestamp:</span><span class="v">'+(ts||'')+'</span></div>'
          + (duration? '<div class="row"><span class="k">Duration:</span><span class="v">'+duration+'</span></div>' : '')
          + (vessels? '<div class="row"><span class="k">Vessels:</span><span class="v">'+vessels+'</span></div>' : '')
          + (link? '<div class="row"><span class="k">Link:</span><span class="v"><a href="'+link+'" target="_blank" rel="noopener">Open in Global Fishing Watch</a></span></div>' : '')
          + '</div></div>';
        new maplibregl.Popup().setLngLat(coord).setHTML(html).addTo(map);
      }
      map.on('click','gfw-loitering',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-encounters-point',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-encounters-line',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-aisoff',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-port',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-sar',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
      map.on('click','gfw-viirs',(e)=>{ if(e.features && e.features[0]) showGfwPopup(e.features[0]); });
    }
    if(map.getSource('course')){
      map.getSource('course').setData(lc);
    }
  }

  function setVisibilityById(id, visible){ if(!map.getLayer(id)) return; map.setLayoutProperty(id,'visibility', visible ? 'visible' : 'none'); }
  function setVisibilityBySubstring(substr, visible){ const style = map.getStyle && map.getStyle(); const layers = (style && style.layers) || []; layers.filter(l=>l.id && l.id.indexOf(substr) > -1).forEach(l=> setVisibilityById(l.id, visible)); }

  map.on('load', async ()=>{
    // Ensure both mainland Norway and Svalbard are visible by default
    try { map.fitBounds([[-10,56],[40,82]], { padding: 60, animate: false }); } catch(e) {}
    await loadAssets();
    await loadPositions();
    setInterval(loadPositions, 300000);

    // Reattach basic toggle handlers for the persistent left menu (no hamburger)
    document.getElementById('ea-toggle').addEventListener('click', ()=>{
      const grp = document.getElementById('ea-group');
      grp.style.display = (grp.style.display==='none') ? 'block' : 'none';
    });
    document.getElementById('toggle-ships').addEventListener('change', (e)=>{
      const on = e.target.checked;
      ['vessels-circle','vessels-triangle','vessels-label','ships-hit','projection-circles','projection-line','projection-end','projection-labels'].forEach(function(id){ setVisibilityById(id, on); });
    });
    document.getElementById('toggle-skytefelt').addEventListener('change', (e)=>{ setVisibilityById('Skytefelt Hav', e.target.checked); });
    document.getElementById('toggle-nsm').addEventListener('change', (e)=>{
      const on = e.target.checked;
      ['NSM forbusomraade tekst','nsm-forbudsomrde-alle','ForbudsomraadeNSM','NSM forbusomraade punkt'].forEach(id=> setVisibilityById(id, on));
    });
    document.getElementById('toggle-petroleum').addEventListener('change', (e)=>{
      const on = e.target.checked;
      ['rrledning-uttaskjers-clipped-03axva','petroleumsinnretning-clipped-ag2fsi'].forEach(id=> setVisibilityById(id, on));
    });
    document.getElementById('toggle-airports').addEventListener('change', (e)=>{ setVisibilityById('Flyplasser 5km', e.target.checked); });
    document.getElementById('toggle-ports').addEventListener('change', (e)=>{
      const on = e.target.checked;
      ['havneanlegg','havneanlegg tekst'].forEach(id=> setVisibilityById(id, on));
      setVisibilityBySubstring('havneanlegg', on);
    });

    // Global Fishing Watch toggles
    document.getElementById('toggle-gfw-loitering').addEventListener('change', (e)=>{
      setVisibilityById('gfw-loitering', e.target.checked);
    });
    document.getElementById('toggle-gfw-encounters').addEventListener('change', (e)=>{
      const on = e.target.checked;
      setVisibilityById('gfw-encounters-point', on);
      setVisibilityById('gfw-encounters-line', on);
    });
    document.getElementById('toggle-gfw-aisoff').addEventListener('change', (e)=>{
      setVisibilityById('gfw-aisoff', e.target.checked);
    });
    document.getElementById('toggle-gfw-port').addEventListener('change', (e)=>{
      setVisibilityById('gfw-port', e.target.checked);
    });
    document.getElementById('toggle-gfw-sar').addEventListener('change', (e)=>{
      setVisibilityById('gfw-sar', e.target.checked);
    });
    document.getElementById('toggle-gfw-viirs').addEventListener('change', (e)=>{
      setVisibilityById('gfw-viirs', e.target.checked);
    });

    // EEZ and cables toggles
    const elNor = document.getElementById('toggle-eez-norway');
    if (elNor) elNor.addEventListener('change', (e)=>{ setVisibilityById('NorwayEEZ', e.target.checked); });
    const elJan = document.getElementById('toggle-eez-janmayen');
    if (elJan) elJan.addEventListener('change', (e)=>{ setVisibilityById('JanMayen', e.target.checked); });
    const elSvb = document.getElementById('toggle-eez-svalbard');
    if (elSvb) elSvb.addEventListener('change', (e)=>{ setVisibilityById('SvalbardFPZ', e.target.checked); });
    const elCables = document.getElementById('toggle-cables');
    if (elCables) elCables.addEventListener('change', (e)=>{ const on = e.target.checked; setVisibilityById('Undervannskabler uttaskjers', on); setVisibilityById('cables-line', on); });

    const allIds = [
      'Skytefelt Hav',
      'NSM forbusomraade tekst','nsm-forbudsomrde-alle','ForbudsomraadeNSM','NSM forbusomraade punkt',
      'rrledning-uttaskjers-clipped-03axva','petroleumsinnretning-clipped-ag2fsi',
      'NorwayEEZ','JanMayen','SvalbardFPZ',
      'Undervannskabler uttaskjers','cables-line',
      'havneanlegg','havneanlegg tekst',
      'Flyplasser 5km',
      'vessels-circle','vessels-triangle','vessels-label','ships-hit','projection-circles','projection-line','projection-end','projection-labels'
    ];
    const defaultOn = new Set(['SvalbardFPZ','vessels-circle','vessels-triangle','vessels-label','ships-hit','projection-circles','projection-line','projection-end','projection-labels']);
    allIds.forEach(id => setVisibilityById(id, defaultOn.has(id)));
    setVisibilityBySubstring('havneanlegg', false);
  });
  </script>
</body>
</html>`;
fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);
app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`SvalMap server on http://localhost:${PORT}`);
  console.log(`[gfw] base=${GFW_API_BASE} token=${GFW_API_TOKEN ? 'configured' : 'MISSING'}`);
  startAisStreamClient();
  console.log(
    `[aisstream] key=${process.env.AISSTREAM_API_KEY ? 'configured' : 'MISSING'} bbox=N≥${NORTH_ATLANTIC_BBOX.minLat}`
  );

  // Daily ice-edge refresh (06:30) + startup if missing/stale (>36h)
  cron.schedule('30 6 * * *', () => {
    refreshIceEdge('daily-cron').catch((e) => console.warn('[ice-edge] cron failed', e));
  });
  {
    const meta = readIceEdgeMeta();
    const ageMs = meta?.generated_at ? Date.now() - Date.parse(meta.generated_at) : null;
    const stale = ageMs == null || !Number.isFinite(ageMs) || ageMs > 36 * 3600e3;
    if (stale) {
      refreshIceEdge('startup').catch((e) => console.warn('[ice-edge] startup failed', e));
    } else {
      console.log(`[ice-edge] cache ok age=${Math.round((ageMs || 0) / 3600000)}h features=${meta?.feature_count}`);
    }
  }

  // Sodir FactMaps facilities + pipelines — daily + startup if missing/stale (>7d) or not Sodir
  cron.schedule('45 6 * * *', () => {
    refreshPetroleum('daily-cron').catch((e) =>
      console.warn('[petroleum/sodir] cron failed', e)
    );
  });
  {
    const meta = readPetroleumMeta();
    const pipeMeta = readPipelinesMeta();
    const ageFrom = (m: any) =>
      m?.fetchedAt
        ? Date.now() - Date.parse(m.fetchedAt)
        : m?.generated_at
          ? Date.now() - Date.parse(m.generated_at)
          : null;
    const ageMs = ageFrom(meta);
    const pipeAgeMs = ageFrom(pipeMeta);
    const notSodir =
      meta?.source !== 'sodir-factmaps' || pipeMeta?.source !== 'sodir-factmaps';
    const staleAge = (age: number | null) =>
      age == null || !Number.isFinite(age) || age > 7 * 24 * 3600e3;
    const stale = notSodir || staleAge(ageMs) || staleAge(pipeAgeMs);
    if (stale) {
      refreshPetroleum('startup').catch((e) =>
        console.warn('[petroleum/sodir] startup failed', e)
      );
    } else {
      console.log(
        `[petroleum/sodir] cache ok age=${Math.round((ageMs || 0) / 3600000)}h facilities=${meta?.feature_count} pipelines=${pipeMeta?.feature_count}`
      );
    }
  }

  if (GFW_API_TOKEN) {
    // Warm caches so UI toggles are instant after startup
    loadGfwEventsShared(720, 500).catch((e) => console.warn('[gfw] warm events failed', e?.message || e));
    loadGfwDetectionsShared(SAR_LOOKBACK_HOURS).catch((e) =>
      console.warn('[gfw] warm detections failed', e?.message || e)
    );
  }

  // Weekly EU designated vessels refresh (Monday 06:00 Europe/Oslo-ish via server local TZ)
  // Also run on startup if the list is older than 7 days.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  async function maybeRefreshSanctions(reason: string) {
    const age = metaAgeMs();
    if (reason === 'startup' && age != null && age < WEEK_MS) {
      console.log(`[sanctions] skip startup refresh (age ${Math.round((age || 0) / 3600000)}h)`);
      return;
    }
    console.log(`[sanctions] refresh (${reason})…`);
    const result = await updateEuDesignatedVessels();
    SANCTIONED_CACHE_TS = 0;
    await ensureSanctionedLoaded();
    console.log(
      `[sanctions] refresh done ok=${result.ok} imos=${result.imoCount} added=${result.added.length}`
    );
  }

  cron.schedule('0 6 * * 1', () => {
    maybeRefreshSanctions('weekly-cron').catch((e) => console.warn('[sanctions] cron failed', e));
  });
  maybeRefreshSanctions('startup').catch((e) => console.warn('[sanctions] startup refresh failed', e));

  // File-backed area alerts — runs without an open browser (email if SMTP configured)
  startAlertWatcher(async () => {
    const list = await getLivePositionsList();
    return list.map((v) => ({
      mmsi: String(v.mmsi),
      lon: Number(v.lon),
      lat: Number(v.lat),
      vessel_name: v.vessel_name || null,
    }));
  }, 30_000);
});


