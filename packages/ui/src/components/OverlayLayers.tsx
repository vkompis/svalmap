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
  petroleum: boolean;
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
    id: 'petroleum',
    file: 'pipelines.geojson',
    line: true,
    fillColor: '#f97316',
    fillOpacity: 0,
    lineColor: '#fb923c',
    lineWidth: 1.5,
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

function vis(visible: boolean): 'visible' | 'none' {
  return visible ? 'visible' : 'none';
}

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

type Props = {
  visibility: OverlayVisibility;
  apiBase?: string;
  onCableSelect?: (cable: CableFeatureProps) => void;
};

export default function OverlayLayers({
  visibility,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  onCableSelect,
}: Props) {
  const map = useMap();
  const onCableRef = useRef(onCableSelect);
  onCableRef.current = onCableSelect;

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
            'line-opacity': 0.9,
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
          if (def.id === 'cables' || def.id === 'cables-telegeography') {
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
          map.addLayer({
            id: `${sourceId}-circle`,
            type: 'circle',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: { visibility: vis(visibility[def.id]) },
            paint: {
              'circle-radius': 4,
              'circle-color': def.lineColor,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#fff',
              'circle-opacity': 0.5,
              'circle-stroke-opacity': 0.5,
            },
          });
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
          'circle-radius': 5,
          'circle-color': '#f97316',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.5,
          'circle-stroke-opacity': 0.5,
        },
      });
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

    const cableLayers = [
      'overlay-cables-hit',
      'overlay-cables-telegeography-hit',
      'overlay-tg-landings-circle',
    ];

    const bindClicks = () => {
      if (!mapStyleReady(map)) return;
      for (const lid of cableLayers) {
        if (!safeGetLayer(map, lid)) continue;
        map.off('click', lid, cableClick);
        map.on('click', lid, cableClick);
        map.on('mouseenter', lid, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lid, () => {
          map.getCanvas().style.cursor = '';
        });
      }
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
    const petroPts = 'overlay-petroleum-points-circle';
    if (safeGetLayer(map, petroPts)) {
      map.setLayoutProperty(petroPts, 'visibility', vis(visibility.petroleum));
    }
    const tgVis = vis(visibility['cables-telegeography']);
    if (safeGetLayer(map, 'overlay-tg-landings-circle')) {
      map.setLayoutProperty('overlay-tg-landings-circle', 'visibility', tgVis);
    }
    if (safeGetLayer(map, 'overlay-tg-landings-label')) {
      map.setLayoutProperty('overlay-tg-landings-label', 'visibility', tgVis);
    }
  }, [map, visibility]);

  return null;
}
