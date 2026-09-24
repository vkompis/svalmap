'use client';

import { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';

export type GfwVisibility = {
  loitering: boolean;
  encounters: boolean;
  aisoff: boolean;
  port: boolean;
  sar: boolean;
  viirs: boolean;
};

type Props = {
  visibility: GfwVisibility;
  apiBase?: string;
  hours?: number;
};

const EVENT_LAYER_IDS = [
  'gfw-loitering',
  'gfw-encounters-point',
  'gfw-aisoff',
  'gfw-port',
] as const;

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

function applyVisibility(
  map: Parameters<typeof setVis>[0],
  visibility: GfwVisibility
) {
  setVis(map, 'gfw-loitering', visibility.loitering);
  setVis(map, 'gfw-encounters-point', visibility.encounters);
  setVis(map, 'gfw-aisoff', visibility.aisoff);
  setVis(map, 'gfw-port', visibility.port);
  setVis(map, 'gfw-sar', visibility.sar);
  setVis(map, 'gfw-viirs', visibility.viirs);
  // Keep GFW markers above base overlays
  for (const id of [...EVENT_LAYER_IDS, 'gfw-sar', 'gfw-viirs']) {
    try {
      if (map.getLayer(id) && map.moveLayer) map.moveLayer(id);
    } catch {
      /* ignore */
    }
  }
}

export default function GfwLayers({
  visibility,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  hours = 168,
}: Props) {
  const map = useMap();
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let inFlight: AbortController | undefined;

    function ensureLayers() {
      if (!map.getSource('gfw-events')) {
        map.addSource('gfw-events', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('gfw-loitering')) {
        map.addLayer({
          id: 'gfw-loitering',
          type: 'circle',
          source: 'gfw-events',
          filter: ['==', ['get', 'subtype'], 'loitering'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#f6a21a',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }
      if (!map.getLayer('gfw-encounters-point')) {
        map.addLayer({
          id: 'gfw-encounters-point',
          type: 'circle',
          source: 'gfw-events',
          filter: ['==', ['get', 'subtype'], 'encounter'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#ff3b30',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }
      if (!map.getLayer('gfw-aisoff')) {
        map.addLayer({
          id: 'gfw-aisoff',
          type: 'circle',
          source: 'gfw-events',
          filter: ['==', ['get', 'subtype'], 'ais_off'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#a855f7',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }
      if (!map.getLayer('gfw-port')) {
        map.addLayer({
          id: 'gfw-port',
          type: 'circle',
          source: 'gfw-events',
          filter: ['==', ['get', 'subtype'], 'port_visit'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#22c55e',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }

      if (!map.getSource('gfw-detections')) {
        map.addSource('gfw-detections', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('gfw-sar')) {
        map.addLayer({
          id: 'gfw-sar',
          type: 'circle',
          source: 'gfw-detections',
          filter: ['==', ['get', 'subtype'], 'sar'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#00a2ff',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }
      if (!map.getLayer('gfw-viirs')) {
        map.addLayer({
          id: 'gfw-viirs',
          type: 'circle',
          source: 'gfw-detections',
          filter: ['==', ['get', 'subtype'], 'viirs'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#ffd400',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          },
        });
      }

      applyVisibility(map, visibilityRef.current);
    }

    // Create layers immediately so toggles work before the slow GFW fetch returns
    try {
      ensureLayers();
    } catch {
      /* map style may not be loaded yet */
    }

    async function refresh() {
      try {
        ensureLayers();
        const anyOn =
          visibilityRef.current.loitering ||
          visibilityRef.current.encounters ||
          visibilityRef.current.aisoff ||
          visibilityRef.current.port ||
          visibilityRef.current.sar ||
          visibilityRef.current.viirs;

        inFlight?.abort();
        const controller = new AbortController();
        inFlight = controller;
        const timer = setTimeout(() => controller.abort(), 180000);
        const [evRes, detRes] = await Promise.all([
          fetch(`${apiBase}/api/gfw/events?hours=${hours}`, { signal: controller.signal }),
          fetch(`${apiBase}/api/gfw/detections?hours=${hours}`, { signal: controller.signal }),
        ]);
        clearTimeout(timer);
        if (cancelled) return;

        const evJson = evRes.ok ? await evRes.json() : { events: [], error: `HTTP ${evRes.status}` };
        const detJson = detRes.ok ? await detRes.json() : { detections: [] };

        const events = Array.isArray(evJson.events) ? evJson.events : [];
        const detections = Array.isArray(detJson.detections) ? detJson.detections : [];

        const eventFc = {
          type: 'FeatureCollection',
          features: events
            .map((e: any) => {
              const lon = Number(e.position?.lon ?? e.lon);
              const lat = Number(e.position?.lat ?? e.lat);
              if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
              let subtype = String(e.type || e.subtype || '').toLowerCase();
              if (subtype.includes('loiter')) subtype = 'loitering';
              else if (subtype.includes('encounter') || subtype.includes('transship'))
                subtype = 'encounter';
              else if (subtype.includes('gap') || subtype.includes('ais')) subtype = 'ais_off';
              else if (subtype.includes('port')) subtype = 'port_visit';
              return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: {
                  subtype,
                  time: e.time || e.ts || null,
                  name: Array.isArray(e.vessels) ? e.vessels.join(' / ') : '',
                },
              };
            })
            .filter(Boolean),
        };

        const detFc = {
          type: 'FeatureCollection',
          features: detections
            .map((d: any) => {
              const lon = Number(d.position?.lon ?? d.lon);
              const lat = Number(d.position?.lat ?? d.lat);
              if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
              let subtype = String(d.type || d.subtype || '').toLowerCase();
              if (subtype.includes('sar')) subtype = 'sar';
              else if (subtype.includes('viirs')) subtype = 'viirs';
              return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: { subtype, time: d.time || d.ts || null },
              };
            })
            .filter(Boolean),
        };

        (map.getSource('gfw-events') as any)?.setData(eventFc);
        (map.getSource('gfw-detections') as any)?.setData(detFc);
        applyVisibility(map, visibilityRef.current);

        const types = eventFc.features.reduce((a: Record<string, number>, f: any) => {
          const s = f.properties?.subtype || 'other';
          a[s] = (a[s] || 0) + 1;
          return a;
        }, {});
        console.log(
          `[GfwLayers] events=${eventFc.features.length}`,
          types,
          evJson.error ? `error=${evJson.error}` : '',
          evJson.meta?.cached ? '(cached)' : '',
          anyOn ? '(layer on)' : '(prefetch)'
        );
        if (evJson.error) console.warn('[GfwLayers] API error:', evJson.error);
        if (detJson.meta?.note) console.info('[GfwLayers]', detJson.meta.note);
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          console.warn('[GfwLayers] request timed out — GFW API is slow; retrying later');
        } else {
          console.error('[GfwLayers]', e);
        }
      }
    }

    const start = () => {
      try {
        ensureLayers();
      } catch {
        /* ignore */
      }
      refresh();
    };
    start();
    map.once('load', start);
    map.once('idle', start);
    interval = setInterval(refresh, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      inFlight?.abort();
      if (interval) clearInterval(interval);
      map.off('load', start);
      map.off('idle', start);
    };
  }, [map, apiBase, hours]);

  useEffect(() => {
    try {
      applyVisibility(map, visibility);
    } catch {
      /* layers may not exist yet */
    }
  }, [map, visibility]);

  return null;
}
