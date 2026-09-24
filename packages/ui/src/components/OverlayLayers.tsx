'use client';

import { useEffect } from 'react';
import { useMap } from '../hooks/useMap';

export type OverlayVisibility = {
  'eez-norway': boolean;
  'eez-janmayen': boolean;
  'eez-svalbard': boolean;
  cables: boolean;
  petroleum: boolean;
  nsm: boolean;
  skytefelt: boolean;
  ports: boolean;
  airports: boolean;
};

type OverlayDef = {
  id: keyof OverlayVisibility;
  file: string;
  fill?: boolean;
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
    fill: true,
    line: true,
    fillColor: '#0ea5e9',
    fillOpacity: 0.06,
    lineColor: '#38bdf8',
    lineWidth: 1.5,
  },
  {
    id: 'eez-janmayen',
    file: 'janmayen-eez.geojson',
    fill: true,
    line: true,
    fillColor: '#a78bfa',
    fillOpacity: 0.08,
    lineColor: '#c4b5fd',
    lineWidth: 1.5,
  },
  {
    id: 'eez-svalbard',
    file: 'svalbard-fpz.geojson',
    fill: true,
    line: true,
    fillColor: '#22c55e',
    fillOpacity: 0.08,
    lineColor: '#4ade80',
    lineWidth: 2,
  },
  {
    id: 'cables',
    file: 'cables-all.geojson',
    line: true,
    fillColor: '#00e6ff',
    fillOpacity: 0,
    lineColor: '#00e6ff',
    lineWidth: 2,
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

function vis(visible: boolean): 'visible' | 'none' {
  return visible ? 'visible' : 'none';
}

type Props = {
  visibility: OverlayVisibility;
  apiBase?: string;
};

export default function OverlayLayers({
  visibility,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
}: Props) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;

    async function loadOne(def: OverlayDef) {
      const sourceId = `overlay-${def.id}`;
      if (map.getSource(sourceId)) return;

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
        map.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          layout: { visibility: vis(visibility[def.id]) },
          paint: {
            'line-color': def.lineColor,
            'line-width': def.lineWidth,
          },
        });
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
        },
      });
    }

    async function boot() {
      try {
        await Promise.all(OVERLAYS.map((d) => loadOne(d).catch((e) => console.error(e))));
        await loadPetroleumPoints();
      } catch (e) {
        console.error('[OverlayLayers]', e);
      }
    }

    const start = () => {
      boot();
    };

    // Always attempt; also listen in case style is still loading
    start();
    map.once('load', start);
    map.once('idle', start);

    return () => {
      cancelled = true;
      map.off('load', start);
      map.off('idle', start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, apiBase]);

  useEffect(() => {
    for (const def of OVERLAYS) {
      const sourceId = `overlay-${def.id}`;
      const v = vis(visibility[def.id]);
      for (const suffix of ['fill', 'line', 'circle']) {
        const layerId = `${sourceId}-${suffix}`;
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', v);
        }
      }
    }
    const petroPts = 'overlay-petroleum-points-circle';
    if (map.getLayer(petroPts)) {
      map.setLayoutProperty(petroPts, 'visibility', vis(visibility.petroleum));
    }
  }, [map, visibility]);

  return null;
}
