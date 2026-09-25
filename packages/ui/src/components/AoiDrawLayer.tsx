'use client';

import { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';
import type { AlertPolygon } from '../utils/areaAlerts';
import { mapStyleReady, safeGetLayer, safeGetSource } from '../utils/mapSafe';

type Props = {
  active: boolean;
  draftRing: number[][];
  polygons: { id: string; polygon: AlertPolygon; label?: string }[];
  onMapClick?: (lon: number, lat: number) => void;
};

const DRAFT_POINTS = 'aoi-draft-points';
const DRAFT_LINE = 'aoi-draft-line';
const DRAFT_FILL = 'aoi-draft-fill';
const SAVED = 'aoi-saved';

function buildDraftCollections(ring: number[][]) {
  const points = {
    type: 'FeatureCollection' as const,
    features: ring.map((coordinates, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates },
      properties: { i },
    })),
  };

  const lineCoords = ring.length >= 2 ? [...ring] : [];
  if (ring.length >= 3) lineCoords.push(ring[0]);

  const line = {
    type: 'FeatureCollection' as const,
    features:
      lineCoords.length >= 2
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: lineCoords },
              properties: {},
            },
          ]
        : [],
  };

  const fill = {
    type: 'FeatureCollection' as const,
    features:
      ring.length >= 3
        ? [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'Polygon' as const,
                coordinates: [[...ring, ring[0]]],
              },
              properties: {},
            },
          ]
        : [],
  };

  return { points, line, fill };
}

/**
 * Shows draft AOI vertices/line while drawing, plus saved custom alert polygons.
 * Paints immediately on click (does not wait for React) so the preview feels instant.
 */
export default function AoiDrawLayer({
  active,
  draftRing,
  polygons,
  onMapClick,
}: Props) {
  const map = useMap();
  const onClickRef = useRef(onMapClick);
  onClickRef.current = onMapClick;
  const draftRef = useRef(draftRing);
  draftRef.current = draftRing;
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;

  const bringDraftToFront = () => {
    for (const id of [
      `${DRAFT_FILL}-fill`,
      `${DRAFT_LINE}-line`,
      `${DRAFT_POINTS}-circle`,
      `${SAVED}-fill`,
      `${SAVED}-line`,
    ]) {
      if (safeGetLayer(map, id)) {
        try {
          map.moveLayer(id);
        } catch {
          /* ignore */
        }
      }
    }
  };

  const paintDraft = (ring: number[][]) => {
    if (!mapStyleReady(map)) return false;
    ensureLayers();
    const { points, line, fill } = buildDraftCollections(ring);
    const pSrc = safeGetSource(map, DRAFT_POINTS) as any;
    const lSrc = safeGetSource(map, DRAFT_LINE) as any;
    const fSrc = safeGetSource(map, DRAFT_FILL) as any;
    if (!pSrc || !lSrc || !fSrc) return false;
    pSrc.setData(points);
    lSrc.setData(line);
    fSrc.setData(fill);
    bringDraftToFront();
    return true;
  };

  const paintSaved = () => {
    if (!mapStyleReady(map)) return;
    ensureLayers();
    const src = safeGetSource(map, SAVED) as any;
    src?.setData?.({
      type: 'FeatureCollection',
      features: polygonsRef.current.map((p) => ({
        type: 'Feature',
        geometry: p.polygon,
        properties: { id: p.id, label: p.label || 'AOI' },
      })),
    });
  };

  function ensureLayers() {
    if (!mapStyleReady(map)) return;

    if (!safeGetSource(map, DRAFT_POINTS)) {
      map.addSource(DRAFT_POINTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${DRAFT_POINTS}-circle`,
        type: 'circle',
        source: DRAFT_POINTS,
        paint: {
          'circle-radius': 7,
          'circle-color': '#38bdf8',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
        },
      });
    }

    if (!safeGetSource(map, DRAFT_LINE)) {
      map.addSource(DRAFT_LINE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${DRAFT_LINE}-line`,
        type: 'line',
        source: DRAFT_LINE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 3,
          'line-opacity': 1,
        },
      });
    }

    if (!safeGetSource(map, DRAFT_FILL)) {
      map.addSource(DRAFT_FILL, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${DRAFT_FILL}-fill`,
        type: 'fill',
        source: DRAFT_FILL,
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.22,
        },
      });
    }

    if (!safeGetSource(map, SAVED)) {
      map.addSource(SAVED, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${SAVED}-fill`,
        type: 'fill',
        source: SAVED,
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: `${SAVED}-line`,
        type: 'line',
        source: SAVED,
        paint: { 'line-color': '#f59e0b', 'line-width': 2.5 },
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    const boot = () => {
      if (cancelled) return;
      ensureLayers();
      paintDraft(draftRef.current);
      paintSaved();
    };
    boot();
    map.on('load', boot);
    return () => {
      cancelled = true;
      map.off('load', boot);
      if (!mapStyleReady(map)) return;
      try {
        for (const id of [
          `${DRAFT_POINTS}-circle`,
          `${DRAFT_LINE}-line`,
          `${DRAFT_FILL}-fill`,
          `${SAVED}-line`,
          `${SAVED}-fill`,
        ]) {
          if (safeGetLayer(map, id)) map.removeLayer(id);
        }
        for (const id of [DRAFT_POINTS, DRAFT_LINE, DRAFT_FILL, SAVED]) {
          if (safeGetSource(map, id)) map.removeSource(id);
        }
      } catch {
        /* map already torn down */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    paintDraft(draftRing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, draftRing]);

  useEffect(() => {
    paintSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, polygons]);

  useEffect(() => {
    if (!active) {
      try {
        map.dragPan.enable();
        map.boxZoom.enable();
        map.getCanvas().style.cursor = '';
      } catch {
        /* ignore */
      }
      return;
    }

    ensureLayers();
    try {
      // Empty-ocean "clicks" otherwise become tiny pans and never fire map click;
      // ship clicks are precise so they still registered — hence the asymmetry.
      map.dragPan.disable();
      map.boxZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
    } catch {
      /* ignore */
    }

    const handler = (e: any) => {
      const t = e.originalEvent?.target as HTMLElement | undefined;
      if (
        t?.closest?.(
          '.alert-panel, .drawer, .app-chrome, #detail-drawer, .layers-fab, .alerts-fab, .alert-form'
        )
      ) {
        return;
      }

      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const next = [...draftRef.current, [lon, lat]];
      draftRef.current = next;
      paintDraft(next);
      onClickRef.current?.(lon, lat);
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      try {
        map.dragPan.enable();
        map.boxZoom.enable();
        map.getCanvas().style.cursor = '';
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active]);

  return null;
}
