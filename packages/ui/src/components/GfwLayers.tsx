'use client';

import { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';

export type GfwVisibility = {
  loitering: boolean;
  encounters: boolean;
  aisoff: boolean;
  port: boolean;
  /** SAR with no AIS match (possible dark vessel) */
  sarUnmatched: boolean;
  /** SAR matched to an AIS vessel */
  sarMatched: boolean;
  /**
   * ISO3 flag codes to keep for matched SAR (e.g. `RUS`, `NOR`).
   * Empty = all countries. Applied client-side on already-loaded detections.
   */
  sarMatchedFlags: string[];
  viirs: boolean;
};

/** Common flags in the Barents / Svalbard SAR AOI. */
export const SAR_MATCHED_FLAG_OPTIONS: { code: string; label: string }[] = [
  { code: 'RUS', label: 'Russia' },
  { code: 'NOR', label: 'Norway' },
  { code: 'ISL', label: 'Iceland' },
  { code: 'DNK', label: 'Denmark' },
  { code: 'FRO', label: 'Faroe' },
  { code: 'GBR', label: 'UK' },
  { code: 'CHN', label: 'China' },
  { code: 'DEU', label: 'Germany' },
  { code: 'NLD', label: 'Netherlands' },
  { code: 'POL', label: 'Poland' },
  { code: 'ESP', label: 'Spain' },
  { code: 'FRA', label: 'France' },
  { code: 'PAN', label: 'Panama' },
  { code: 'LBR', label: 'Liberia' },
  { code: 'MHL', label: 'Marshall Is.' },
];

export type GfwEventProps = {
  subtype: string;
  title: string;
  vessels: string;
  mmsi: string | null;
  partnerMmsi: string | null;
  time: string | null;
  end: string | null;
  duration: string | null;
  lon: number;
  lat: number;
  russian: boolean;
  sanctioned: boolean;
  shadowfleet: boolean;
  flag: string | null;
  matched?: boolean | null;
  intentionalDisabling?: boolean | null;
  note?: string | null;
};

type Props = {
  visibility: GfwVisibility;
  apiBase?: string;
  hours?: number;
  onEventSelect?: (event: GfwEventProps) => void;
};

const EVENT_LAYER_IDS = [
  'gfw-aisoff-halo',
  'gfw-loitering',
  'gfw-encounters-point',
  'gfw-aisoff',
  'gfw-port',
] as const;

const DETECTION_LAYER_IDS = ['gfw-sar-unmatched', 'gfw-sar-matched', 'gfw-viirs'] as const;
const HIT_LAYER_ID = 'gfw-events-hit';
const DET_HIT_LAYER_ID = 'gfw-detections-hit';
const SANCTION_BADGE_ID = 'gfw-sanction-badge';
const SHADOW_BADGE_ID = 'gfw-shadow-badge';

const SUBTYPE_LABELS: Record<string, string> = {
  loitering: 'Loitering event',
  encounter: 'Encounter / Transshipment',
  ais_off: 'AIS off event',
  port_visit: 'Port visit',
  sar: 'SAR unmatched (possible dark)',
  sar_matched: 'SAR matched to AIS',
  viirs: 'VIIRS detection',
};

const BADGE_ICON_SIZE = 0.42;
/** Non-ship markers stay semi-transparent so vessels remain the focus. */
const NON_SHIP_MARKER_OPACITY = 0.5;
const NON_SHIP_HALO_OPACITY = 0.15;

/**
 * AIS-off + SAR + GFW events: Shipatlas-style pin dots when zoomed out (tiny),
 * then ease up when zooming in.
 */
const DETECTION_RADIUS: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1.25,
  3.5,
  1.75,
  5,
  2.75,
  7,
  4.5,
  9,
  6.5,
  11,
  8,
];
const DETECTION_HALO_RADIUS: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  2.25,
  3.5,
  3,
  5,
  4.5,
  7,
  7,
  9,
  10,
  11,
  12,
];
const DETECTION_STROKE: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1,
  5,
  1.35,
  8,
  1.75,
  11,
  2.1,
];
const DETECTION_HIT_RADIUS: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  8,
  7,
  14,
  10,
  18,
];

const SAR_CIRCLE_RADIUS = DETECTION_RADIUS;
const SAR_STROKE_WIDTH = DETECTION_STROKE;
const VIIRS_CIRCLE_RADIUS = DETECTION_RADIUS;
const DET_HIT_RADIUS = DETECTION_HIT_RADIUS;
const AIS_OFF_CIRCLE_RADIUS = DETECTION_RADIUS;
const AIS_OFF_HALO_RADIUS = DETECTION_HALO_RADIUS;
const AIS_OFF_STROKE_WIDTH = DETECTION_STROKE;
const EVENT_ZOOM_RADIUS = DETECTION_RADIUS;
const EVENT_HIT_ZOOM_RADIUS = DETECTION_HIT_RADIUS;

async function loadBadgeIcon(
  map: {
    hasImage: (name: string) => boolean;
    addImage: (
      name: string,
      image: ImageData | HTMLImageElement,
      options?: { sdf?: boolean; pixelRatio?: number }
    ) => void;
  },
  name: string,
  url: string
): Promise<void> {
  if (map.hasImage(name)) return;
  const SIZE = 64;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    let svg = await res.text();
    if (!/\swidth\s*=/.test(svg)) {
      svg = svg.replace(/<svg\b/, `<svg width="${SIZE}" height="${SIZE}"`);
    }
    const fillMatch = svg.match(/\.cls-1\s*\{\s*fill:\s*(#[0-9a-fA-F]{3,8})\s*;/);
    if (fillMatch) {
      svg = svg.replace(/class="cls-1"/g, `fill="${fillMatch[1]}"`);
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext('2d');
          if (ctx && !map.hasImage(name)) {
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.drawImage(img, 0, 0, SIZE, SIZE);
            map.addImage(name, ctx.getImageData(0, 0, SIZE, SIZE), {
              sdf: false,
              pixelRatio: 2,
            });
          }
        } catch {
          /* ignore */
        }
        URL.revokeObjectURL(objectUrl);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve();
      };
      img.src = objectUrl;
    });
  } catch {
    /* ignore */
  }
}

function visibleEventSubtypes(visibility: GfwVisibility): string[] {
  const types: string[] = [];
  if (visibility.loitering) types.push('loitering');
  if (visibility.encounters) types.push('encounter');
  if (visibility.aisoff) types.push('ais_off');
  if (visibility.port) types.push('port_visit');
  return types;
}

function eventSubtypeFilter(visibility: GfwVisibility): any {
  const types = visibleEventSubtypes(visibility);
  if (types.length === 0) return ['==', ['get', 'subtype'], '__none__'];
  if (types.length === 1) return ['==', ['get', 'subtype'], types[0]];
  return ['in', ['get', 'subtype'], ['literal', types]];
}

function setVis(
  map: {
    getLayer: (id: string) => unknown;
    setLayoutProperty: (id: string, prop: string, value: string) => void;
    moveLayer?: (id: string) => void;
  },
  id: string,
  on: boolean
) {
  if (map.getLayer(id)) {
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

function normalizeSarMatchedFlags(flags: string[] | undefined | null): string[] {
  if (!Array.isArray(flags) || flags.length === 0) return [];
  return [
    ...new Set(
      flags
        .map((f) => String(f || '').trim().toUpperCase())
        .filter((f) => /^[A-Z]{3}$/.test(f))
    ),
  ];
}

/** MapLibre filter for matched SAR points (subtype + optional flag allow-list). */
export function matchedSarLayerFilter(flags: string[] | undefined | null): any {
  const allow = normalizeSarMatchedFlags(flags);
  const base: any = ['==', ['get', 'subtype'], 'sar_matched'];
  if (allow.length === 0) return base;
  return ['all', base, ['in', ['get', 'flag'], ['literal', allow]]];
}

function detectionHitFilter(visibility: GfwVisibility): any {
  const clauses: any[] = [];
  if (visibility.sarUnmatched) {
    clauses.push(['==', ['get', 'subtype'], 'sar']);
  }
  if (visibility.sarMatched) {
    clauses.push(matchedSarLayerFilter(visibility.sarMatchedFlags));
  }
  if (visibility.viirs) {
    clauses.push(['==', ['get', 'subtype'], 'viirs']);
  }
  if (clauses.length === 0) return ['==', ['get', 'subtype'], '__none__'];
  if (clauses.length === 1) return clauses[0];
  return ['any', ...clauses];
}

function applyVisibility(
  map: {
    getLayer: (id: string) => unknown;
    setLayoutProperty: (id: string, prop: string, value: any) => void;
    setFilter?: (id: string, filter: any) => void;
    moveLayer?: (id: string) => void;
  },
  visibility: GfwVisibility
) {
  setVis(map, 'gfw-loitering', visibility.loitering);
  setVis(map, 'gfw-encounters-point', visibility.encounters);
  setVis(map, 'gfw-aisoff-halo', visibility.aisoff);
  setVis(map, 'gfw-aisoff', visibility.aisoff);
  setVis(map, 'gfw-port', visibility.port);
  setVis(map, 'gfw-sar-unmatched', visibility.sarUnmatched);
  setVis(map, 'gfw-sar-matched', visibility.sarMatched);
  setVis(map, 'gfw-viirs', visibility.viirs);

  if (map.getLayer('gfw-sar-matched') && map.setFilter) {
    map.setFilter('gfw-sar-matched', matchedSarLayerFilter(visibility.sarMatchedFlags));
  }

  const anyEvent =
    visibility.loitering ||
    visibility.encounters ||
    visibility.aisoff ||
    visibility.port;
  const anyDet = visibility.sarUnmatched || visibility.sarMatched || visibility.viirs;
  setVis(map, HIT_LAYER_ID, anyEvent);
  setVis(map, DET_HIT_LAYER_ID, anyDet);
  setVis(map, SANCTION_BADGE_ID, anyEvent);
  setVis(map, SHADOW_BADGE_ID, anyEvent);

  // Hit layer only receives currently visible detection subtypes (+ flag filter)
  if (map.getLayer(DET_HIT_LAYER_ID) && map.setFilter) {
    map.setFilter(DET_HIT_LAYER_ID, detectionHitFilter(visibility));
  }

  const subtypeFilter = eventSubtypeFilter(visibility);
  if (map.getLayer(SANCTION_BADGE_ID) && map.setFilter) {
    map.setFilter(SANCTION_BADGE_ID, [
      'all',
      subtypeFilter,
      ['==', ['get', 'sanctioned'], 1],
    ]);
  }
  if (map.getLayer(SHADOW_BADGE_ID) && map.setFilter) {
    map.setFilter(SHADOW_BADGE_ID, [
      'all',
      subtypeFilter,
      ['==', ['get', 'shadowfleet'], 1],
    ]);
  }

  for (const id of [
    ...EVENT_LAYER_IDS,
    ...DETECTION_LAYER_IDS,
    HIT_LAYER_ID,
    DET_HIT_LAYER_ID,
    SANCTION_BADGE_ID,
    SHADOW_BADGE_ID,
  ]) {
    try {
      if (map.getLayer(id) && map.moveLayer) map.moveLayer(id);
    } catch {
      /* ignore */
    }
  }
}

function formatDurationHours(raw: unknown): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 48) return `${n.toFixed(1)} h`;
  return `${(n / 24).toFixed(1)} days`;
}

function normalizeSubtype(raw: unknown): string {
  const subtype = String(raw || '').toLowerCase();
  if (subtype.includes('loiter')) return 'loitering';
  if (subtype.includes('encounter') || subtype.includes('transship')) return 'encounter';
  if (subtype.includes('gap') || subtype.includes('ais')) return 'ais_off';
  if (subtype.includes('port')) return 'port_visit';
  if (subtype.includes('sar_matched') || subtype.includes('sar-matched')) return 'sar_matched';
  if (subtype.includes('sar')) return 'sar';
  if (subtype.includes('viirs')) return 'viirs';
  return subtype || 'event';
}

function propsFromFeature(f: any): GfwEventProps | null {
  const p = f?.properties || {};
  const coords = f?.geometry?.coordinates;
  const lon = Number(p.lon ?? coords?.[0]);
  const lat = Number(p.lat ?? coords?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const subtype = normalizeSubtype(p.subtype || p.type);
  const vessels = String(p.vessels || p.name || '').trim();
  return {
    subtype,
    title: SUBTYPE_LABELS[subtype] || 'GFW event',
    vessels: vessels || 'Unknown vessel',
    mmsi: p.mmsi != null && String(p.mmsi) !== '' ? String(p.mmsi) : null,
    partnerMmsi:
      p.partnerMmsi != null && String(p.partnerMmsi) !== '' ? String(p.partnerMmsi) : null,
    time: p.time ? String(p.time) : null,
    end: p.end ? String(p.end) : null,
    duration: p.durationLabel ? String(p.durationLabel) : formatDurationHours(p.duration),
    lon,
    lat,
    russian: Boolean(Number(p.russian) || p.russian === true || p.russian === 'true'),
    sanctioned: Boolean(Number(p.sanctioned) || p.sanctioned === true || p.sanctioned === 'true'),
    shadowfleet: Boolean(
      Number(p.shadowfleet) || p.shadowfleet === true || p.shadowfleet === 'true'
    ),
    flag: p.flag ? String(p.flag) : null,
    matched:
      p.matched == null || p.matched === ''
        ? null
        : Boolean(Number(p.matched) || p.matched === true || p.matched === 'true'),
    intentionalDisabling:
      p.intentionalDisabling == null || p.intentionalDisabling === ''
        ? null
        : Boolean(
            Number(p.intentionalDisabling) ||
              p.intentionalDisabling === true ||
              p.intentionalDisabling === 'true'
          ),
    note: p.note ? String(p.note) : null,
  };
}

type GfwFc = {
  type: 'FeatureCollection';
  features: any[];
};

/** Survive React Strict Mode remounts — don't abort the shared fetch. */
let sharedEventsFc: GfwFc = { type: 'FeatureCollection', features: [] };
let sharedDetFc: GfwFc = { type: 'FeatureCollection', features: [] };
let sharedFetch: Promise<void> | null = null;
let sharedFetchKey = '';

function mapEventsToFc(events: any[]): GfwFc {
  return {
    type: 'FeatureCollection',
    features: events
      .map((e: any) => {
        const lon = Number(e.position?.lon ?? e.lon);
        const lat = Number(e.position?.lat ?? e.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const subtype = normalizeSubtype(e.type || e.subtype);
        const vesselsList = Array.isArray(e.vessels)
          ? e.vessels.map((v: any) => String(v)).filter(Boolean)
          : [];
        const vessels = vesselsList.join(' / ');
        const durationLabel = formatDurationHours(e.duration);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            subtype,
            title: SUBTYPE_LABELS[subtype] || 'GFW event',
            time: e.time || e.ts || '',
            end: e.end || '',
            duration: e.duration ?? '',
            durationLabel: durationLabel || '',
            vessels: vessels || 'Unknown vessel',
            name: vessels || 'Unknown vessel',
            mmsi: e.mmsi != null ? String(e.mmsi) : '',
            partnerMmsi: e.partnerMmsi != null ? String(e.partnerMmsi) : '',
            russian: e.russian ? 1 : 0,
            sanctioned: e.sanctioned ? 1 : 0,
            shadowfleet: e.shadowfleet ? 1 : 0,
            intentionalDisabling: e.intentionalDisabling ? 1 : 0,
            flag: e.flag || '',
            lon,
            lat,
          },
        };
      })
      .filter(Boolean),
  };
}

function mapDetectionsToFc(detections: any[]): GfwFc {
  return {
    type: 'FeatureCollection',
    features: detections
      .map((d: any) => {
        const lon = Number(d.position?.lon ?? d.lon);
        const lat = Number(d.position?.lat ?? d.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const matched = d.matched === true || d.type === 'sar_matched';
        const subtype = matched ? 'sar_matched' : normalizeSubtype(d.type || d.subtype || 'sar');
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            subtype,
            title: SUBTYPE_LABELS[subtype] || 'GFW detection',
            time: d.time || d.ts || '',
            end: '',
            duration: '',
            durationLabel: '',
            vessels: d.vessel || d.name || (matched ? 'SAR+AIS' : 'Unmatched SAR'),
            name: d.vessel || d.name || (matched ? 'SAR+AIS' : 'Unmatched SAR'),
            mmsi: d.mmsi != null ? String(d.mmsi) : '',
            partnerMmsi: '',
            russian: 0,
            sanctioned: 0,
            shadowfleet: 0,
            intentionalDisabling: 0,
            matched: matched ? 1 : 0,
            note: d.note || '',
            flag: d.flag ? String(d.flag).toUpperCase() : '',
            lon,
            lat,
          },
        };
      })
      .filter(Boolean),
  };
}

async function loadGfwShared(apiBase: string, hours: number, force = false): Promise<void> {
  const key = `${apiBase}|${hours}`;
  if (!force && sharedFetch && sharedFetchKey === key) return sharedFetch;
  // Only skip when we already have both events and detections for this key
  if (
    !force &&
    sharedFetchKey === key &&
    sharedEventsFc.features.length > 0 &&
    sharedDetFc.features.length > 0
  ) {
    return;
  }
  sharedFetchKey = key;
  sharedFetch = (async () => {
    const [evRes, detRes] = await Promise.all([
      fetch(`${apiBase}/api/gfw/events?hours=${hours}`),
      // SAR is fixed server-side to 30d inside Norway EEZ / Jan Mayen EEZ / Svalbard FPZ
      fetch(`${apiBase}/api/gfw/detections?hours=720`),
    ]);
    const evJson = evRes.ok ? await evRes.json() : { events: [], error: `HTTP ${evRes.status}` };
    const detJson = detRes.ok ? await detRes.json() : { detections: [] };
    const events = Array.isArray(evJson.events) ? evJson.events : [];
    const detections = Array.isArray(detJson.detections) ? detJson.detections : [];
    // Don't clobber a good in-memory cache with an empty "still loading" response
    if (events.length > 0 || !evJson?.meta?.loading) {
      sharedEventsFc = mapEventsToFc(events);
    }
    if (detections.length > 0 || !detJson?.meta?.loading) {
      sharedDetFc = mapDetectionsToFc(detections);
    }
    const types = sharedEventsFc.features.reduce((a: Record<string, number>, f: any) => {
      const s = f.properties?.subtype || 'other';
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {});
    console.log(
      `[GfwLayers] events=${sharedEventsFc.features.length}`,
      types,
      `detections=${sharedDetFc.features.length}`,
      detJson.meta?.zones ? `zones=${detJson.meta.zones}` : '',
      evJson.error ? `error=${evJson.error}` : '',
      evJson.meta?.cached ? '(cached)' : '',
      evJson.meta?.loading ? '(loading)' : '',
      evJson.meta?.filter ? `filter=${evJson.meta.filter}` : ''
    );
    if (evJson.error) console.warn('[GfwLayers] API error:', evJson.error);
  })().finally(() => {
    sharedFetch = null;
  });
  return sharedFetch;
}

export default function GfwLayers({
  visibility,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  hours = 720,
  onEventSelect,
}: Props) {
  const map = useMap();
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const onSelectRef = useRef(onEventSelect);
  onSelectRef.current = onEventSelect;

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let clickHandler: ((e: any) => void) | undefined;
    let enterHandler: (() => void) | undefined;
    let leaveHandler: (() => void) | undefined;

    function ensureLayers() {
      const upsertCircle = (spec: {
        id: string;
        source: string;
        filter?: any;
        paint: Record<string, any>;
      }) => {
        try {
          if (!map.getLayer(spec.id)) {
            map.addLayer({
              id: spec.id,
              type: 'circle',
              source: spec.source,
              ...(spec.filter ? { filter: spec.filter } : {}),
              layout: { visibility: 'none' },
              paint: spec.paint,
            });
          } else {
            for (const [k, v] of Object.entries(spec.paint)) {
              try {
                map.setPaintProperty(spec.id, k as any, v);
              } catch {
                /* keep previous paint */
              }
            }
          }
        } catch (e) {
          console.error('[GfwLayers] layer failed', spec.id, e);
          try {
            if (map.getLayer(spec.id)) map.removeLayer(spec.id);
          } catch {
            /* ignore */
          }
          try {
            map.addLayer({
              id: spec.id,
              type: 'circle',
              source: spec.source,
              ...(spec.filter ? { filter: spec.filter } : {}),
              layout: { visibility: 'none' },
              paint: spec.paint,
            });
          } catch (e2) {
            console.error('[GfwLayers] layer retry failed', spec.id, e2);
          }
        }
      };

      if (!map.getSource('gfw-events')) {
        map.addSource('gfw-events', {
          type: 'geojson',
          data: sharedEventsFc,
        });
      }
      upsertCircle({
        id: 'gfw-loitering',
        source: 'gfw-events',
        filter: ['==', ['get', 'subtype'], 'loitering'],
        paint: {
          'circle-radius': EVENT_ZOOM_RADIUS,
          'circle-color': '#f6a21a',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: 'gfw-encounters-point',
        source: 'gfw-events',
        filter: ['==', ['get', 'subtype'], 'encounter'],
        paint: {
          'circle-radius': EVENT_ZOOM_RADIUS,
          'circle-color': '#ff3b30',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: 'gfw-aisoff-halo',
        source: 'gfw-events',
        filter: ['==', ['get', 'subtype'], 'ais_off'],
        paint: {
          'circle-radius': AIS_OFF_HALO_RADIUS,
          'circle-color': '#a855f7',
          'circle-opacity': NON_SHIP_HALO_OPACITY,
          'circle-stroke-width': 0,
        },
      });
      upsertCircle({
        id: 'gfw-aisoff',
        source: 'gfw-events',
        filter: ['==', ['get', 'subtype'], 'ais_off'],
        paint: {
          'circle-radius': AIS_OFF_CIRCLE_RADIUS,
          'circle-color': '#a855f7',
          'circle-stroke-width': AIS_OFF_STROKE_WIDTH,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'intentionalDisabling'], 1],
            '#fef08a',
            '#f5d0fe',
          ],
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
          'circle-stroke-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: 'gfw-port',
        source: 'gfw-events',
        filter: ['==', ['get', 'subtype'], 'port_visit'],
        paint: {
          'circle-radius': EVENT_ZOOM_RADIUS,
          'circle-color': '#22c55e',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: HIT_LAYER_ID,
        source: 'gfw-events',
        paint: {
          'circle-radius': EVENT_HIT_ZOOM_RADIUS,
          'circle-opacity': 0,
          'circle-stroke-width': 0,
        },
      });

      if (!map.getLayer(SANCTION_BADGE_ID)) {
        try {
          map.addLayer({
            id: SANCTION_BADGE_ID,
            type: 'symbol',
            source: 'gfw-events',
            filter: ['==', ['get', 'sanctioned'], 1],
            layout: {
              visibility: 'none',
              'icon-image': 'Sanksjon',
              'icon-size': BADGE_ICON_SIZE,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'center',
            },
            paint: {
              'icon-opacity': NON_SHIP_MARKER_OPACITY,
              'icon-translate': [11, -9],
              'icon-translate-anchor': 'viewport',
            },
          });
        } catch (e) {
          console.error('[GfwLayers] badge failed', SANCTION_BADGE_ID, e);
        }
      }
      if (!map.getLayer(SHADOW_BADGE_ID)) {
        try {
          map.addLayer({
            id: SHADOW_BADGE_ID,
            type: 'symbol',
            source: 'gfw-events',
            filter: ['==', ['get', 'shadowfleet'], 1],
            layout: {
              visibility: 'none',
              'icon-image': 'ShadowTriangle',
              'icon-size': BADGE_ICON_SIZE,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'center',
            },
            paint: {
              'icon-opacity': NON_SHIP_MARKER_OPACITY,
              'icon-translate': [11, 8],
              'icon-translate-anchor': 'viewport',
            },
          });
        } catch (e) {
          console.error('[GfwLayers] badge failed', SHADOW_BADGE_ID, e);
        }
      }

      if (!map.getSource('gfw-detections')) {
        map.addSource('gfw-detections', {
          type: 'geojson',
          data: sharedDetFc,
        });
      }
      // Remove legacy combined SAR layer if present (from earlier builds)
      try {
        if (map.getLayer('gfw-sar')) map.removeLayer('gfw-sar');
      } catch {
        /* ignore */
      }
      upsertCircle({
        id: 'gfw-sar-unmatched',
        source: 'gfw-detections',
        filter: ['==', ['get', 'subtype'], 'sar'],
        paint: {
          'circle-radius': SAR_CIRCLE_RADIUS,
          'circle-color': '#f59e0b',
          'circle-stroke-width': SAR_STROKE_WIDTH,
          'circle-stroke-color': '#fde68a',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
          'circle-stroke-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: 'gfw-sar-matched',
        source: 'gfw-detections',
        filter: ['==', ['get', 'subtype'], 'sar_matched'],
        paint: {
          'circle-radius': SAR_CIRCLE_RADIUS,
          'circle-color': '#4ade80',
          'circle-stroke-width': SAR_STROKE_WIDTH,
          'circle-stroke-color': '#bbf7d0',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
          'circle-stroke-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: 'gfw-viirs',
        source: 'gfw-detections',
        filter: ['==', ['get', 'subtype'], 'viirs'],
        paint: {
          'circle-radius': VIIRS_CIRCLE_RADIUS,
          'circle-color': '#ffd400',
          'circle-stroke-width': SAR_STROKE_WIDTH,
          'circle-stroke-color': '#fff',
          'circle-opacity': NON_SHIP_MARKER_OPACITY,
        },
      });
      upsertCircle({
        id: DET_HIT_LAYER_ID,
        source: 'gfw-detections',
        paint: {
          'circle-radius': DET_HIT_RADIUS,
          'circle-opacity': 0,
          'circle-stroke-width': 0,
        },
      });

      applyVisibility(map, visibilityRef.current);

      if (!clickHandler) {
        clickHandler = (e: any) => {
          const f = e?.features?.[0];
          if (!f || !onSelectRef.current) return;
          const event = propsFromFeature(f);
          if (event) onSelectRef.current(event);
        };
        enterHandler = () => {
          map.getCanvas().style.cursor = 'pointer';
        };
        leaveHandler = () => {
          map.getCanvas().style.cursor = '';
        };
        for (const id of [
          HIT_LAYER_ID,
          DET_HIT_LAYER_ID,
          ...EVENT_LAYER_IDS,
          ...DETECTION_LAYER_IDS,
          SANCTION_BADGE_ID,
          SHADOW_BADGE_ID,
        ]) {
          map.on('click', id, clickHandler);
          map.on('mouseenter', id, enterHandler);
          map.on('mouseleave', id, leaveHandler);
        }
      }
    }

    function applySharedData() {
      try {
        ensureLayers();
        (map.getSource('gfw-events') as any)?.setData(sharedEventsFc);
        (map.getSource('gfw-detections') as any)?.setData(sharedDetFc);
        applyVisibility(map, visibilityRef.current);
      } catch (e) {
        console.error('[GfwLayers] applySharedData', e);
      }
    }

    async function refresh(force = false) {
      try {
        // Don't block on isStyleLoaded() — it can stay false while tiles stream,
        // and 'load' may have already fired before this effect mounted.
        try {
          ensureLayers();
        } catch {
          await Promise.race([
            new Promise<void>((r) => map.once('idle', () => r())),
            new Promise<void>((r) => setTimeout(r, 1500)),
          ]);
          if (cancelled) return;
          ensureLayers();
        }
        await Promise.all([
          loadBadgeIcon(map, 'Sanksjon', '/markers/Circles/Sanksjon.svg'),
          loadBadgeIcon(map, 'ShadowTriangle', '/markers/Circles/shadowtriangle.svg'),
        ]);
        // Always apply whatever we have so toggles paint immediately
        applySharedData();
        await loadGfwShared(apiBase, hours, force);
        if (cancelled) return;
        applySharedData();
        // GFW loads progressively (gaps first). Poll until we have events or give up.
        for (let i = 0; i < 4 && sharedEventsFc.features.length === 0; i++) {
          await new Promise<void>((r) => setTimeout(r, 6000));
          if (cancelled) return;
          await loadGfwShared(apiBase, hours, true);
          if (cancelled) return;
          applySharedData();
        }
        // One more pass after a short wait — denser datasets may still be filling in
        if (sharedEventsFc.features.some((f: any) => f.properties?.subtype === 'ais_off')) {
          await new Promise<void>((r) => setTimeout(r, 15000));
          if (cancelled) return;
          await loadGfwShared(apiBase, hours, true);
          if (cancelled) return;
          applySharedData();
        }
      } catch (e: any) {
        console.error('[GfwLayers]', e);
        if (!cancelled) {
          setTimeout(() => {
            refresh(true).catch(() => undefined);
          }, 4000);
        }
      }
    }

    refresh(false);
    interval = setInterval(() => refresh(true), 10 * 60 * 1000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      // Do NOT abort the shared fetch — remounts reuse it
      if (clickHandler) {
        for (const id of [
          HIT_LAYER_ID,
          DET_HIT_LAYER_ID,
          ...EVENT_LAYER_IDS,
          ...DETECTION_LAYER_IDS,
          SANCTION_BADGE_ID,
          SHADOW_BADGE_ID,
        ]) {
          map.off('click', id, clickHandler);
          if (enterHandler) map.off('mouseenter', id, enterHandler);
          if (leaveHandler) map.off('mouseleave', id, leaveHandler);
        }
      }
    };
  }, [map, apiBase, hours]);

  useEffect(() => {
    try {
      applyVisibility(map, visibility);
      const needEvents =
        (visibility.loitering ||
          visibility.encounters ||
          visibility.aisoff ||
          visibility.port) &&
        sharedEventsFc.features.length === 0;
      const needDets =
        (visibility.sarUnmatched || visibility.sarMatched) &&
        sharedDetFc.features.length === 0;
      if (needEvents || needDets || visibility.viirs) {
        loadGfwShared(apiBase, hours, needDets || needEvents)
          .then(() => {
            (map.getSource('gfw-events') as any)?.setData(sharedEventsFc);
            (map.getSource('gfw-detections') as any)?.setData(sharedDetFc);
            applyVisibility(map, visibilityRef.current);
          })
          .catch(() => undefined);
      } else {
        (map.getSource('gfw-detections') as any)?.setData(sharedDetFc);
        (map.getSource('gfw-events') as any)?.setData(sharedEventsFc);
      }
    } catch {
      /* layers may not exist yet */
    }
  }, [map, visibility, apiBase, hours]);

  return null;
}
