/**
 * Fetch Sodir FactMaps "Pipelines" (layer 311) as GeoJSON.
 * Source: https://factmaps.sodir.no — synced daily with Sodir databases.
 * Petroleum transport pipelines only (±50 m; segments within 500 m of facilities omitted).
 */
import fs from 'fs';
import path from 'path';

const SODIR_BASE =
  'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/MapServer/311/query';
const PAGE_SIZE = 50;
const WHERE = '1=1';
const OUT_FIELDS = [
  'OBJECTID',
  'pplNpdidPipeline',
  'pplName',
  'pplMapLabel',
  'pplBelongsToName',
  'cmpLongName',
  'pplCurrentPhase',
  'fclNameFrom',
  'fclNameTo',
  'pplMainGroupingName',
  'pplDimension',
  'pplWaterDepth',
  'pplMedium',
  'pplDateUpdated',
  'pplFactPageUrl',
].join(',');

export type SodirPipelineFetchResult = {
  ok: boolean;
  featureCount?: number;
  path?: string;
  error?: string;
  meta?: Record<string, unknown>;
};

function epochToIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function pathsToGeometry(paths: unknown): {
  type: 'LineString' | 'MultiLineString';
  coordinates: number[][] | number[][][];
} | null {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  const lines: number[][][] = [];
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < 2) continue;
    const coords: number[][] = [];
    for (const pt of path) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      coords.push([lon, lat]);
    }
    if (coords.length >= 2) lines.push(coords);
  }
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return { type: 'LineString', coordinates: lines[0] };
  }
  return { type: 'MultiLineString', coordinates: lines };
}

function mapFeature(f: any): any | null {
  const raw = f?.geometry;
  const p = f?.properties || f?.attributes || {};
  let geometry: any = null;
  if (raw?.type === 'LineString' || raw?.type === 'MultiLineString') {
    geometry = raw;
  } else if (raw?.paths) {
    geometry = pathsToGeometry(raw.paths);
  }
  if (!geometry) return null;

  const id = p.pplNpdidPipeline != null ? String(p.pplNpdidPipeline) : null;
  const name = p.pplName ? String(p.pplName).trim() : null;
  if (!name && !id) return null;

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: id || name,
      name: name || `Pipeline ${id}`,
      mapLabel: p.pplMapLabel ? String(p.pplMapLabel) : null,
      medium: p.pplMedium ? String(p.pplMedium) : null,
      phase: p.pplCurrentPhase ? String(p.pplCurrentPhase) : null,
      operator: p.cmpLongName ? String(p.cmpLongName) : null,
      belongsTo: p.pplBelongsToName ? String(p.pplBelongsToName) : null,
      fromFacility: p.fclNameFrom ? String(p.fclNameFrom) : null,
      toFacility: p.fclNameTo ? String(p.fclNameTo) : null,
      grouping: p.pplMainGroupingName ? String(p.pplMainGroupingName) : null,
      dimensionInch:
        p.pplDimension != null && p.pplDimension !== ''
          ? Number(p.pplDimension)
          : null,
      waterDepthM:
        p.pplWaterDepth != null && p.pplWaterDepth !== ''
          ? Number(p.pplWaterDepth)
          : null,
      updated: epochToIso(p.pplDateUpdated),
      factPageUrl: p.pplFactPageUrl ? String(p.pplFactPageUrl) : null,
      source: 'sodir-factmaps',
    },
  };
}

async function fetchPage(offset: number): Promise<{
  features: any[];
  exceeded?: boolean;
}> {
  const q = new URLSearchParams({
    where: WHERE,
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'json',
  });
  const url = `${SODIR_BASE}?${q.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Sodir HTTP ${res.status}`);
  }
  const data = (await res.json()) as any;
  if (data?.error) {
    throw new Error(data.error?.message || JSON.stringify(data.error));
  }
  const raw = Array.isArray(data?.features) ? data.features : [];
  return {
    features: raw,
    exceeded: Boolean(data?.exceededTransferLimit),
  };
}

export async function fetchSodirPipelinesToFile(
  outDir: string
): Promise<SodirPipelineFetchResult> {
  try {
    const all: any[] = [];
    let offset = 0;
    for (let page = 0; page < 40; page++) {
      const { features, exceeded } = await fetchPage(offset);
      console.log(
        `[sodir/pipelines] page=${page} offset=${offset} got=${features.length}`
      );
      all.push(...features);
      if (features.length === 0) break;
      offset += features.length;
      if (!exceeded) break;
    }
    const mapped = all.map(mapFeature).filter(Boolean) as any[];
    if (mapped.length < all.length) {
      console.warn(
        `[sodir/pipelines] dropped ${all.length - mapped.length} features without usable geometry`
      );
    }
    const fc = {
      type: 'FeatureCollection',
      features: mapped,
    };
    fs.mkdirSync(outDir, { recursive: true });
    const geoPath = path.join(outDir, 'pipelines.geojson');
    const metaPath = path.join(outDir, 'pipelines.meta.json');
    const tmp = `${geoPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(fc));
    fs.renameSync(tmp, geoPath);
    const meta = {
      source: 'sodir-factmaps',
      layer: 'FactMapsWGS84/311 Pipelines',
      where: WHERE,
      url: SODIR_BASE,
      generated_at: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      feature_count: mapped.length,
      note:
        'Sodir FactMaps petroleum transport pipelines (daily sync). Accuracy ±50 m; tracks within 500 m of facilities are omitted by Sodir.',
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { ok: true, featureCount: mapped.length, path: geoPath, meta };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

if (require.main === module) {
  const out =
    process.argv[2] ||
    path.join(__dirname, '..', 'data', 'source', 'overlays');
  fetchSodirPipelinesToFile(out).then((r) => {
    if (!r.ok) {
      console.error('[sodir/pipelines]', r.error);
      process.exit(1);
    }
    console.log(`[sodir/pipelines] wrote ${r.featureCount} pipelines → ${r.path}`);
  });
}
