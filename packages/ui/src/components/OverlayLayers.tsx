'use client';

import { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';
import { mapStyleReady, safeGetLayer } from '../utils/mapSafe';

export type OverlayVisibility = {
  'eez-norway': boolean;
  'eez-janmayen': boolean;
  'eez-svalbard': boolean;
  cables: boolean;
  'cables-telegeography': boolean;
  /** Sodir petroleum transport pipelines (in use) */
  pipelines: boolean;
  /** Legacy GeoNorge chart pipelines (not in use) */
  'pipelines-old': boolean;
  /** Sodir oil / gas facility points */
  petroleum: boolean;
  /** Open Waters Seascape bathymetry (depth shading + contours) */
  bathymetry: boolean;
  nsm: boolean;
  skytefelt: boolean;
  ports: boolean;
  airports: boolean;
  'ice-edge': boolean;
  /** All currently in-force Kystverket warnings */
  navwarnings: boolean;
  /** In-force warnings issued within the last 30 days */
  'navwarnings-30d': boolean;
};

type OverlayDef = {
  id: keyof OverlayVisibility;
  file: string;
  /** Outer maritime boundary only (LineString) — avoids fjord/hole stroke clutter */
  boundaryFile?: string;
  fill?: boolean;
  /** Stroke full polygon (all rings). Prefer boundaryFile for EEZs. */
  line?: boolean;
  circle?: boolean;
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
  lineOpacity?: number;
};

const OVERLAYS: OverlayDef[] = [
  {
    id: 'eez-norway',
    file: 'norway-eez.geojson',
    boundaryFile: 'norway-eez-boundary.geojson',
    fill: true,
    line: false,
    fillColor: '#0ea5e9',
    fillOpacity: 0.05,
    lineColor: '#38bdf8',
    lineWidth: 2,
  },
  {
    id: 'eez-janmayen',
    file: 'janmayen-eez.geojson',
    boundaryFile: 'janmayen-eez-boundary.geojson',
    fill: true,
    line: false,
    fillColor: '#a78bfa',
    fillOpacity: 0.06,
    lineColor: '#c4b5fd',
    lineWidth: 2,
  },
  {
    id: 'eez-svalbard',
    file: 'svalbard-fpz.geojson',
    boundaryFile: 'svalbard-fpz-boundary.geojson',
    fill: true,
    line: false,
    fillColor: '#22c55e',
    fillOpacity: 0.06,
    lineColor: '#4ade80',
    lineWidth: 2.25,
  },
  {
    id: 'ice-edge',
    file: 'ice-edge.geojson',
    line: true,
    fillColor: '#e0f2fe',
    fillOpacity: 0,
    lineColor: '#7dd3fc',
    lineWidth: 2.5,
  },
  {
    id: 'cables',
    file: 'cables-all.geojson',
    line: true,
    fillColor: '#00e6ff',
    fillOpacity: 0,
    lineColor: '#00e6ff',
    lineWidth: 1.5,
  },
  {
    id: 'cables-telegeography',
    file: 'cables-telegeography-norway.geojson',
    line: true,
    fillColor: '#f472b6',
    fillOpacity: 0,
    lineColor: '#f472b6',
    lineWidth: 2.5,
  },
  {
    id: 'pipelines-old',
    file: 'pipelines-geonorge.geojson',
    line: true,
    fillColor: '#94a3b8',
    fillOpacity: 0,
    lineColor: '#94a3b8',
    lineWidth: 1.25,
    lineOpacity: 0.55,
  },
  {
    id: 'pipelines',
    file: 'pipelines.geojson',
    line: true,
    fillColor: '#f97316',
    fillOpacity: 0,
    lineColor: '#fb923c',
    lineWidth: 2,
  },
  {
    id: 'nsm',
    file: 'nsm.geojson',
    fill: true,
    line: true,
    fillColor: '#ef4444',
    fillOpacity: 0.12,
    lineColor: '#f87171',
    lineWidth: 1.5,
  },
  {
    id: 'skytefelt',
    file: 'skytefelt.geojson',
    fill: true,
    line: true,
    fillColor: '#eab308',
    fillOpacity: 0.12,
    lineColor: '#facc15',
    lineWidth: 1.5,
  },
  {
    id: 'ports',
    file: 'ports.geojson',
    circle: true,
    fill: true,
    line: true,
    fillColor: '#64748b',
    fillOpacity: 0.15,
    lineColor: '#94a3b8',
    lineWidth: 1,
  },
];

const PETROLEUM_POINTS_FILE = 'petroleum.geojson';
const TG_LANDINGS_FILE = 'cable-landings-telegeography-norway.geojson';

/** Open Waters Seascape — GEBCO + EMODnet mosaic, MapLibre-native tiles (CC BY 4.0). */
const SEASCAPE_BASE = 'https://tiles.openwaters.io/seascape';
const BATHY_DEM_SOURCE = 'overlay-bathymetry-dem';
const BATHY_VEC_SOURCE = 'overlay-bathymetry-vector';
const BATHY_LAYER_IDS = [
  'overlay-bathymetry-contours',
  'overlay-bathymetry-labels',
] as const;

/**
 * Contours only (no depare fills / hillshade).
 * Semi-transparent vector fills and raster-dem hillshade both draw tile-grid
 * seams (straight vertical/horizontal lines) in MapLibre — avoid them here.
 */
const BATHY_IS_MAJOR: any = [
  '==',
  ['%', ['coalesce', ['to-number', ['get', 'depth_abs_m']], -1], 500],
  0,
];

const BATHY_LINE_COLOR: any = [
  'case',
  BATHY_IS_MAJOR,
  '#8aa4bc',
  '#6b849e',
];

const BATHY_LINE_WIDTH: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  ['case', BATHY_IS_MAJOR, 1.0, 0.55],
  7,
  ['case', BATHY_IS_MAJOR, 1.4, 0.8],
  11,
  ['case', BATHY_IS_MAJOR, 1.8, 1.0],
];

const BATHY_LINE_OPACITY: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  0.45,
  6,
  0.6,
  10,
  0.75,
];

/** Depth labels — thin at z6 (500 m majors), denser from z8. */
const BATHY_LABEL_FILTER: any = [
  'all',
  ['!=', ['get', 'sys'], 'ft'],
  [
    'step',
    ['zoom'],
    [
      '==',
      ['%', ['coalesce', ['to-number', ['get', 'depth_abs_m']], -1], 500],
      0,
    ],
    8,
    [
      'any',
      [
        '==',
        ['%', ['coalesce', ['to-number', ['get', 'depth_abs_m']], -1], 200],
        0,
      ],
      [
        '==',
        ['%', ['coalesce', ['to-number', ['get', 'depth_abs_m']], -1], 500],
        0,
      ],
    ],
    10,
    ['has', 'depth_abs_m'],
  ],
];

const BATHY_LABEL_SIZE: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  9,
  8,
  10.5,
  10,
  12,
  12,
  13.5,
  14,
  15,
];

const BATHY_LABEL_COLOR = '#a8c0d4';
const BATHY_LABEL_HALO = 'rgba(8, 15, 24, 0.85)';

function applyBathymetryPaint(map: {
  setPaintProperty: (id: string, prop: string, value: unknown) => void;
  setLayoutProperty: (id: string, prop: string, value: unknown) => void;
  setFilter: (id: string, filter: unknown) => void;
  getLayer: (id: string) => unknown;
}) {
  if (map.getLayer('overlay-bathymetry-contours')) {
    map.setPaintProperty('overlay-bathymetry-contours', 'line-color', BATHY_LINE_COLOR);
    map.setPaintProperty('overlay-bathymetry-contours', 'line-width', BATHY_LINE_WIDTH);
    map.setPaintProperty(
      'overlay-bathymetry-contours',
      'line-opacity',
      BATHY_LINE_OPACITY
    );
  }
  if (map.getLayer('overlay-bathymetry-labels')) {
    map.setLayoutProperty('overlay-bathymetry-labels', 'text-size', BATHY_LABEL_SIZE);
    map.setLayoutProperty('overlay-bathymetry-labels', 'text-field', [
      'to-string',
      [
        'abs',
        ['to-number', ['coalesce', ['get', 'depth_abs_m'], ['get', 'depth_m'], 0]],
      ],
    ]);
    map.setFilter('overlay-bathymetry-labels', BATHY_LABEL_FILTER);
    map.setPaintProperty('overlay-bathymetry-labels', 'text-color', BATHY_LABEL_COLOR);
    map.setPaintProperty('overlay-bathymetry-labels', 'text-halo-color', BATHY_LABEL_HALO);
    map.setPaintProperty('overlay-bathymetry-labels', 'text-halo-width', 1.25);
  }
}

function beforeIdForBathymetry(map: {
  getStyle: () => { layers?: { id: string; type: string }[] } | undefined;
}): string | undefined {
  const layers = map.getStyle()?.layers || [];
  const overlay = layers.find(
    (l) => l.id.startsWith('overlay-') && !l.id.startsWith('overlay-bathymetry')
  );
  if (overlay) return overlay.id;
  const symbol = layers.find((l) => l.type === 'symbol');
  return symbol?.id;
}

function vis(visible: boolean): 'visible' | 'none' {
  return visible ? 'visible' : 'none';
}

/**
 * Same zoom curve as SAR / AIS-off detections, but a notch smaller when zoomed in
 * so dense coastal clusters stay readable.
 */
const PORT_CIRCLE_RADIUS: any = [
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
  4,
  9,
  5.5,
  11,
  6.5,
];
const PORT_STROKE_WIDTH: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1,
  5,
  1.25,
  8,
  1.5,
  11,
  1.85,
];
const PORT_HIT_RADIUS: any = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  8,
  7,
  13,
  10,
  16,
];

export type CableFeatureProps = {
  id: string;
  name: string;
  source: string;
  kind: 'nkom' | 'telegeography' | 'landing';
  is_planned?: boolean;
  rfs_year?: number | null;
  color?: string | null;
  kabeltype?: string | null;
};

/** Norwegian PFSA port facility (Kystverket / GeoNorge). */
export type PortFeatureProps = {
  id: string;
  name: string;
  harbour: string | null;
  ownerType: string | null;
  status: string | null;
  functions: string | null;
  hasCruise: string | null;
  safeLoading: string | null;
  approvalValidTo: string | null;
  council: string | null;
  county: string | null;
};

/** Petroleum installation point (Sodir FactMaps facilities). */
export type RigFeatureProps = {
  id: string;
  name: string;
  kind: string | null;
  phase: string | null;
  fixedOrMoveable: string | null;
  operator: string | null;
  belongsTo: string | null;
  functions: string | null;
  status: string | null;
  waterDepthM: number | null;
  updated: string | null;
  factPageUrl: string | null;
};

/** Pipeline line (Sodir active or legacy GeoNorge chart). */
export type PipelineFeatureProps = {
  id: string;
  name: string;
  medium: string | null;
  phase: string | null;
  operator: string | null;
  belongsTo: string | null;
  fromFacility: string | null;
  toFacility: string | null;
  dimensionInch: number | null;
  waterDepthM: number | null;
  updated: string | null;
  factPageUrl: string | null;
  /** Chart pipeline type (GeoNorge), e.g. gass / olje / vann */
  chartType: string | null;
  inUse: boolean;
  source: 'sodir' | 'geonorge';
};

type Props = {
  visibility: OverlayVisibility;
  apiBase?: string;
  onCableSelect?: (cable: CableFeatureProps) => void;
  onPortSelect?: (port: PortFeatureProps) => void;
  onRigSelect?: (rig: RigFeatureProps) => void;
  onPipelineSelect?: (pipeline: PipelineFeatureProps) => void;
};

function strProp(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function numProp(p: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = p[k];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default function OverlayLayers({
  visibility,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  onCableSelect,
  onPortSelect,
  onRigSelect,
  onPipelineSelect,
}: Props) {
  const map = useMap();
  const onCableRef = useRef(onCableSelect);
  onCableRef.current = onCableSelect;
  const onPortRef = useRef(onPortSelect);
  onPortRef.current = onPortSelect;
  const onRigRef = useRef(onRigSelect);
  onRigRef.current = onRigSelect;
  const onPipelineRef = useRef(onPipelineSelect);
  onPipelineRef.current = onPipelineSelect;

  useEffect(() => {
    let cancelled = false;

    async function loadOne(def: OverlayDef) {
      if (!mapStyleReady(map)) return;
      const sourceId = `overlay-${def.id}`;
      if (!map.getSource(sourceId)) {
        const url = `${apiBase}/overlays/${def.file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load ${def.file}: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        map.addSource(sourceId, { type: 'geojson', data });

        if (def.fill) {
          map.addLayer({
            id: `${sourceId}-fill`,
            type: 'fill',
            source: sourceId,
            layout: { visibility: vis(visibility[def.id]) },
            paint: {
              'fill-color': def.fillColor,
              'fill-opacity': def.fillOpacity,
            },
          });
        }
          if (def.line) {
          const paint: any = {
            'line-width': def.lineWidth,
            'line-opacity': def.lineOpacity ?? 0.9,
          };
          if (def.id === 'cables-telegeography') {
            paint['line-color'] = ['coalesce', ['get', 'color'], def.lineColor];
          } else {
            paint['line-color'] = def.lineColor;
          }
          map.addLayer({
            id: `${sourceId}-line`,
            type: 'line',
            source: sourceId,
            layout: {
              visibility: vis(visibility[def.id]),
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint,
          });
          if (
            def.id === 'cables' ||
            def.id === 'cables-telegeography' ||
            def.id === 'pipelines' ||
            def.id === 'pipelines-old'
          ) {
            map.addLayer({
              id: `${sourceId}-hit`,
              type: 'line',
              source: sourceId,
              layout: {
                visibility: vis(visibility[def.id]),
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': '#000',
                'line-width': 14,
                'line-opacity': 0,
              },
            });
          }
        }
        if (def.circle) {
          const isPorts = def.id === 'ports';
          map.addLayer({
            id: `${sourceId}-circle`,
            type: 'circle',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: { visibility: vis(visibility[def.id]) },
            paint: {
              'circle-radius': isPorts ? PORT_CIRCLE_RADIUS : 4,
              'circle-color': def.lineColor,
              'circle-stroke-width': isPorts ? PORT_STROKE_WIDTH : 1,
              'circle-stroke-color': '#fff',
              'circle-opacity': 0.5,
              'circle-stroke-opacity': 0.5,
            },
          });
          if (isPorts) {
            map.addLayer({
              id: `${sourceId}-hit`,
              type: 'circle',
              source: sourceId,
              filter: ['==', ['geometry-type'], 'Point'],
              layout: { visibility: vis(visibility[def.id]) },
              paint: {
                'circle-radius': PORT_HIT_RADIUS,
                'circle-opacity': 0,
                'circle-stroke-width': 0,
              },
            });
          }
        }
      }

      if (def.boundaryFile) {
        const bId = `overlay-${def.id}-boundary`;
        if (map.getSource(bId)) return;
        const res = await fetch(`${apiBase}/overlays/${def.boundaryFile}`);
        if (!res.ok) throw new Error(`Failed to load ${def.boundaryFile}: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        map.addSource(bId, { type: 'geojson', data });
        map.addLayer({
          id: `${bId}-line`,
          type: 'line',
          source: bId,
          layout: {
            visibility: vis(visibility[def.id]),
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': def.lineColor,
            'line-width': def.lineWidth,
            'line-opacity': 0.95,
          },
        });
      }
    }

    async function loadPetroleumPoints() {
      const sourceId = 'overlay-petroleum-points';
      if (map.getSource(sourceId)) return;
      const res = await fetch(`${apiBase}/overlays/${PETROLEUM_POINTS_FILE}`);
      if (!res.ok) return;
      const data = await res.json();
      if (cancelled) return;
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: `${sourceId}-circle`,
        type: 'circle',
        source: sourceId,
        layout: { visibility: vis(visibility.petroleum) },
        paint: {
          'circle-radius': PORT_CIRCLE_RADIUS,
          'circle-color': '#f97316',
          'circle-stroke-width': PORT_STROKE_WIDTH,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.5,
          'circle-stroke-opacity': 0.5,
        },
      });
      map.addLayer({
        id: `${sourceId}-hit`,
        type: 'circle',
        source: sourceId,
        layout: { visibility: vis(visibility.petroleum) },
        paint: {
          'circle-radius': PORT_HIT_RADIUS,
          'circle-opacity': 0,
          'circle-stroke-width': 0,
        },
      });
    }

    /**
     * Open Waters Seascape bathymetry — contours + depth labels only.
     * Depth-area fills and DEM hillshade are omitted: both cause straight
     * tile-grid seams (vertical/horizontal lines) in MapLibre.
     */
    async function loadBathymetry() {
      if (!mapStyleReady(map)) return;
      const beforeId = beforeIdForBathymetry(map);
      const v = vis(visibility.bathymetry);

      // Drop legacy layers that produce tile-seam artifacts
      for (const legacyId of [
        'overlay-bathymetry-hillshade',
        'overlay-bathymetry-depth',
      ]) {
        if (safeGetLayer(map, legacyId)) {
          try {
            map.removeLayer(legacyId);
          } catch {
            /* ignore */
          }
        }
      }
      if (map.getSource(BATHY_DEM_SOURCE)) {
        try {
          map.removeSource(BATHY_DEM_SOURCE);
        } catch {
          /* ignore */
        }
      }

      if (!map.getSource(BATHY_VEC_SOURCE)) {
        map.addSource(BATHY_VEC_SOURCE, {
          type: 'vector',
          url: `${SEASCAPE_BASE}/vector.json`,
          attribution:
            '© <a href="https://openwaters.io/charts/seascape#license">Open Waters</a> (GEBCO / EMODnet)',
        });
      }

      if (!safeGetLayer(map, 'overlay-bathymetry-contours')) {
        map.addLayer(
          {
            id: 'overlay-bathymetry-contours',
            type: 'line',
            source: BATHY_VEC_SOURCE,
            'source-layer': 'contours',
            filter: ['!=', ['get', 'sys'], 'ft'],
            minzoom: 3,
            layout: {
              visibility: v,
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': BATHY_LINE_COLOR,
              'line-width': BATHY_LINE_WIDTH,
              'line-opacity': BATHY_LINE_OPACITY,
            },
          } as any,
          beforeId
        );
      }

      if (!safeGetLayer(map, 'overlay-bathymetry-labels')) {
        map.addLayer(
          {
            id: 'overlay-bathymetry-labels',
            type: 'symbol',
            source: BATHY_VEC_SOURCE,
            'source-layer': 'contours',
            filter: BATHY_LABEL_FILTER,
            minzoom: 6,
            layout: {
              visibility: v,
              'symbol-placement': 'line',
              'symbol-spacing': 60,
              'text-field': [
                'to-string',
                [
                  'abs',
                  [
                    'to-number',
                    ['coalesce', ['get', 'depth_abs_m'], ['get', 'depth_m'], 0],
                  ],
                ],
              ],
              'text-font': ['NRK Sans Medium', 'Arial Unicode MS Regular'],
              'text-size': BATHY_LABEL_SIZE,
              'text-max-angle': 30,
              'text-padding': 28,
              'text-letter-spacing': 0.05,
              'text-optional': true,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
            },
            paint: {
              'text-color': BATHY_LABEL_COLOR,
              'text-halo-color': BATHY_LABEL_HALO,
              'text-halo-width': 1.25,
              'text-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                6,
                0.75,
                9,
                0.9,
              ],
            },
          } as any,
          beforeId
        );
      }

      applyBathymetryPaint(map);
    }

    async function loadTgLandings() {
      const sourceId = 'overlay-tg-landings';
      if (map.getSource(sourceId)) return;
      const res = await fetch(`${apiBase}/overlays/${TG_LANDINGS_FILE}`);
      if (!res.ok) return;
      const data = await res.json();
      if (cancelled) return;
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: `${sourceId}-circle`,
        type: 'circle',
        source: sourceId,
        layout: { visibility: vis(visibility['cables-telegeography']) },
        paint: {
          'circle-radius': 4,
          'circle-color': '#f9a8d4',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.5,
          'circle-stroke-opacity': 0.5,
        },
      });
      map.addLayer({
        id: `${sourceId}-label`,
        type: 'symbol',
        source: sourceId,
        layout: {
          visibility: vis(visibility['cables-telegeography']),
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#fbcfe8',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1,
        },
      });
    }

    async function boot() {
      try {
        await Promise.all(OVERLAYS.map((d) => loadOne(d).catch((e) => console.error(e))));
        await loadBathymetry().catch((e) => console.error('[bathymetry]', e));
        await loadPetroleumPoints();
        await loadTgLandings();
      } catch (e) {
        console.error('[OverlayLayers]', e);
      }
    }

    const start = () => {
      boot();
    };

    const cableClick = (e: any) => {
      const f = e.features?.[0];
      if (!f || !onCableRef.current) return;
      e.originalEvent?.stopPropagation?.();
      const p = f.properties || {};
      const layerId = String(f.layer?.id || '');
      const isTg = layerId.includes('telegeography') || layerId.includes('tg-landings');
      const isLanding = layerId.includes('tg-landings');
      onCableRef.current({
        id: String(p.id || p.lokalid || p.name || 'cable'),
        name: String(p.name || p.navn || p.kabeltype || 'Undersea cable'),
        source: String(
          p.source ||
            (isTg
              ? 'TeleGeography Submarine Cable Map'
              : 'Nkom / GeoNorge')
        ),
        kind: isLanding ? 'landing' : isTg ? 'telegeography' : 'nkom',
        is_planned: p.is_planned === true || p.is_planned === 'true',
        rfs_year: p.rfs_year != null && p.rfs_year !== '' ? Number(p.rfs_year) : null,
        color: p.color ? String(p.color) : null,
        kabeltype: p.kabeltype ? String(p.kabeltype) : null,
      });
    };

    const portClick = (e: any) => {
      const f = e.features?.[0];
      if (!f || !onPortRef.current) return;
      e.originalEvent?.stopPropagation?.();
      const p = (f.properties || {}) as Record<string, unknown>;
      const id = strProp(p, 'portfacilityno', 'id') || 'port';
      const name =
        strProp(p, 'locationnamenor', 'name', 'harbour') || `Port ${id}`;
      onPortRef.current({
        id,
        name,
        harbour: strProp(p, 'harbour'),
        ownerType: strProp(p, 'ownertypenor', 'ownertype'),
        status: strProp(p, 'portfacilitystatusnor', 'status'),
        functions: strProp(p, 'functionsnor', 'functions'),
        hasCruise: strProp(p, 'hascruisefunction'),
        safeLoading: strProp(p, 'issafeloadingcompliant'),
        approvalValidTo: strProp(p, 'pfsaapprovalperiodvalidto'),
        council: strProp(p, 'councilname'),
        county: strProp(p, 'countyname'),
      });
    };

    const rigClick = (e: any) => {
      const f = e.features?.[0];
      if (!f || !onRigRef.current) return;
      e.originalEvent?.stopPropagation?.();
      const p = (f.properties || {}) as Record<string, unknown>;
      const id =
        strProp(p, 'id', 'fclNpdidFacility', 'lokalId', 'lokalid') || 'rig';
      const name =
        strProp(p, 'name', 'fclName') ||
        strProp(p, 'kind', 'fclKind') ||
        `Facility ${id}`;
      const depth = numProp(p, 'waterDepthM', 'fclWaterDepth');
      onRigRef.current({
        id,
        name,
        kind: strProp(p, 'kind', 'fclKind', 'petroleuminnretningtype'),
        phase: strProp(p, 'phase', 'fclPhase'),
        fixedOrMoveable: strProp(p, 'fixedOrMoveable', 'fclFixedOrMoveable'),
        operator: strProp(p, 'operator', 'fclCurrentOperatorName'),
        belongsTo: strProp(p, 'belongsTo', 'fclBelongsToName'),
        functions: strProp(p, 'functions', 'fclFunctions'),
        status: strProp(p, 'status', 'fclStatus'),
        waterDepthM: depth,
        updated: strProp(p, 'updated', 'fclDateUpdated', 'oppdateringsdato'),
        factPageUrl: strProp(p, 'factPageUrl', 'fclFactPageUrl'),
      });
    };

    const pipelineClick = (e: any) => {
      const f = e.features?.[0];
      if (!f || !onPipelineRef.current) return;
      e.originalEvent?.stopPropagation?.();
      const p = (f.properties || {}) as Record<string, unknown>;
      const layerId = String(f.layer?.id || '');
      const isUnused = layerId.includes('pipelines-old');
      const id =
        strProp(p, 'id', 'pplNpdidPipeline', 'lokalId', 'lokalid', 'gml_id') ||
        'pipeline';
      const name =
        strProp(p, 'name', 'pplName', 'mapLabel', 'pplMapLabel') ||
        strProp(p, 'type', 'rørledningstype', 'rorledningstype') ||
        `Pipeline ${id}`;
      const chartType = strProp(p, 'chartType', 'type', 'rørledningstype', 'rorledningstype');
      onPipelineRef.current({
        id,
        name,
        medium: strProp(p, 'medium', 'pplMedium') || chartType,
        phase: isUnused
          ? 'not in use'
          : strProp(p, 'phase', 'pplCurrentPhase'),
        operator: strProp(p, 'operator', 'cmpLongName'),
        belongsTo: strProp(p, 'belongsTo', 'pplBelongsToName'),
        fromFacility: strProp(p, 'fromFacility', 'fclNameFrom'),
        toFacility: strProp(p, 'toFacility', 'fclNameTo'),
        dimensionInch: numProp(p, 'dimensionInch', 'pplDimension'),
        waterDepthM: numProp(p, 'waterDepthM', 'pplWaterDepth'),
        updated: strProp(p, 'updated', 'pplDateUpdated', 'oppdateringsdato'),
        factPageUrl: strProp(p, 'factPageUrl', 'pplFactPageUrl'),
        chartType,
        inUse: isUnused
          ? false
          : !(p.inUse === false || p.inUse === 'false'),
        source: isUnused ? 'geonorge' : 'sodir',
      });
    };

    const cableLayers = [
      'overlay-cables-hit',
      'overlay-cables-telegeography-hit',
      'overlay-tg-landings-circle',
    ];
    const portLayers = ['overlay-ports-hit', 'overlay-ports-circle'];
    const rigLayers = [
      'overlay-petroleum-points-hit',
      'overlay-petroleum-points-circle',
    ];
    const pipelineLayers = [
      'overlay-pipelines-hit',
      'overlay-pipelines-old-hit',
    ];

    const bindLayerClick = (lid: string, handler: (e: any) => void) => {
      if (!safeGetLayer(map, lid)) return;
      map.off('click', lid, handler);
      map.on('click', lid, handler);
      map.on('mouseenter', lid, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', lid, () => {
        map.getCanvas().style.cursor = '';
      });
    };

    const bindClicks = () => {
      if (!mapStyleReady(map)) return;
      for (const lid of cableLayers) bindLayerClick(lid, cableClick);
      for (const lid of portLayers) bindLayerClick(lid, portClick);
      for (const lid of rigLayers) bindLayerClick(lid, rigClick);
      for (const lid of pipelineLayers) bindLayerClick(lid, pipelineClick);
    };

    start();
    map.once('load', start);
    map.once('idle', () => {
      start();
      bindClicks();
    });
    const bindTimer = setInterval(bindClicks, 2000);

    return () => {
      cancelled = true;
      clearInterval(bindTimer);
      map.off('load', start);
      map.off('idle', start);
      for (const lid of cableLayers) {
        map.off('click', lid, cableClick);
      }
      for (const lid of portLayers) {
        map.off('click', lid, portClick);
      }
      for (const lid of rigLayers) {
        map.off('click', lid, rigClick);
      }
      for (const lid of pipelineLayers) {
        map.off('click', lid, pipelineClick);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, apiBase]);

  useEffect(() => {
    if (!mapStyleReady(map)) return;
    for (const def of OVERLAYS) {
      const sourceId = `overlay-${def.id}`;
      const v = vis(visibility[def.id]);
      for (const suffix of ['fill', 'line', 'circle', 'hit']) {
        const layerId = `${sourceId}-${suffix}`;
        if (safeGetLayer(map, layerId)) {
          map.setLayoutProperty(layerId, 'visibility', v);
        }
      }
      const bLine = `overlay-${def.id}-boundary-line`;
      if (safeGetLayer(map, bLine)) {
        map.setLayoutProperty(bLine, 'visibility', v);
      }
    }
    // Keep ports / oil rigs on the SAR-style zoom curve even if created earlier
    if (safeGetLayer(map, 'overlay-ports-circle')) {
      try {
        map.setPaintProperty('overlay-ports-circle', 'circle-radius', PORT_CIRCLE_RADIUS);
        map.setPaintProperty('overlay-ports-circle', 'circle-stroke-width', PORT_STROKE_WIDTH);
      } catch {
        /* ignore */
      }
    }
    if (safeGetLayer(map, 'overlay-ports-hit')) {
      try {
        map.setPaintProperty('overlay-ports-hit', 'circle-radius', PORT_HIT_RADIUS);
      } catch {
        /* ignore */
      }
    }
    const petroPts = 'overlay-petroleum-points-circle';
    if (safeGetLayer(map, petroPts)) {
      map.setLayoutProperty(petroPts, 'visibility', vis(visibility.petroleum));
      try {
        map.setPaintProperty(petroPts, 'circle-radius', PORT_CIRCLE_RADIUS);
        map.setPaintProperty(petroPts, 'circle-stroke-width', PORT_STROKE_WIDTH);
      } catch {
        /* ignore */
      }
    }
    const petroHit = 'overlay-petroleum-points-hit';
    if (safeGetLayer(map, petroHit)) {
      map.setLayoutProperty(petroHit, 'visibility', vis(visibility.petroleum));
      try {
        map.setPaintProperty(petroHit, 'circle-radius', PORT_HIT_RADIUS);
      } catch {
        /* ignore */
      }
    }
    const tgVis = vis(visibility['cables-telegeography']);
    if (safeGetLayer(map, 'overlay-tg-landings-circle')) {
      map.setLayoutProperty('overlay-tg-landings-circle', 'visibility', tgVis);
    }
    if (safeGetLayer(map, 'overlay-tg-landings-label')) {
      map.setLayoutProperty('overlay-tg-landings-label', 'visibility', tgVis);
    }
    const bathyVis = vis(visibility.bathymetry);
    // Ensure seam-causing legacy layers stay gone even if the map was hot-reloaded
    for (const legacyId of [
      'overlay-bathymetry-hillshade',
      'overlay-bathymetry-depth',
    ]) {
      if (safeGetLayer(map, legacyId)) {
        try {
          map.removeLayer(legacyId);
        } catch {
          /* ignore */
        }
      }
    }
    for (const lid of BATHY_LAYER_IDS) {
      if (safeGetLayer(map, lid)) {
        map.setLayoutProperty(lid, 'visibility', bathyVis);
      }
    }
    if (visibility.bathymetry) {
      try {
        applyBathymetryPaint(map);
      } catch {
        /* ignore */
      }
    }
  }, [map, visibility]);

  return null;
}
