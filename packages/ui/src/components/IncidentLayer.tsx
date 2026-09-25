'use client';

import React, { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';
import axios from 'axios';
import { mapStyleReady, safeGetLayer, safeGetSource } from '../utils/mapSafe';

export type NavWarningProps = {
  kind: 'navarea' | 'coastal' | string;
  eventid: string | number | null;
  status: string;
  warningnumber: string | null;
  title: string;
  message: string | null;
  location: string | null;
  issued: string | null;
  updated_at: string | null;
  recent?: boolean;
};

type Props = {
  /** Show all currently in-force warnings */
  showActive?: boolean;
  /** Show warnings issued within the last 30 days (subset of active from public API) */
  showRecent30d?: boolean;
  interactive?: boolean;
  onWarningSelect?: (warning: NavWarningProps) => void;
};

const LAYER_IDS = [
  'nav-warnings-fill',
  'nav-warnings-line',
  'nav-warnings-point',
  'nav-warnings-label',
] as const;

function propsFromFeature(f: any): NavWarningProps | null {
  const p = f?.properties || {};
  const title = String(p.title || '').trim();
  if (!title && p.eventid == null) return null;
  return {
    kind: String(p.kind || 'navarea'),
    eventid: p.eventid != null && String(p.eventid) !== '' ? p.eventid : null,
    status: String(p.status || 'active'),
    warningnumber: p.warningnumber != null ? String(p.warningnumber) : null,
    title: title || `Warning ${p.eventid || ''}`.trim(),
    message: p.message != null && String(p.message) !== '' ? String(p.message) : null,
    location: p.location != null && String(p.location) !== '' ? String(p.location) : null,
    issued: p.issued != null ? String(p.issued) : null,
    updated_at: p.updated_at != null ? String(p.updated_at) : null,
    recent: Number(p.recent) === 1 || p.recent === true,
  };
}

/**
 * Kystverket NAVAREA XIX + coastal warnings.
 * Public API only returns in-force warnings; "30 days" filters by issue date.
 */
export default function IncidentLayer({
  showActive = false,
  showRecent30d = false,
  interactive = true,
  onWarningSelect,
}: Props) {
  const map = useMap();
  const apiBase =
    (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:8787';
  const showActiveRef = useRef(showActive);
  showActiveRef.current = showActive;
  const showRecentRef = useRef(showRecent30d);
  showRecentRef.current = showRecent30d;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const onSelectRef = useRef(onWarningSelect);
  onSelectRef.current = onWarningSelect;

  const applyVisibilityAndFilter = () => {
    if (!mapStyleReady(map)) return;
    const active = showActiveRef.current;
    const recent = showRecentRef.current;
    const any = active || recent;
    const v = any ? 'visible' : 'none';

    // Active = all in-force; 30d = recent only; both = all (union).
    const dateFilter =
      recent && !active ? (['==', ['get', 'recent'], 1] as any) : null;

    for (const lid of LAYER_IDS) {
      if (!safeGetLayer(map, lid)) continue;
      map.setLayoutProperty(lid, 'visibility', v);
      try {
        if (dateFilter) {
          // Keep geometry filter from layer def by combining — setFilter replaces entirely,
          // so rebuild per layer type below via paint-only visibility when possible.
          map.setFilter(lid, buildLayerFilter(lid, dateFilter));
        } else {
          map.setFilter(lid, buildLayerFilter(lid, null));
        }
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    const id = 'nav-warnings';
    let cancelled = false;
    let clickHandler: ((e: any) => void) | undefined;
    let enterHandler: (() => void) | undefined;
    let leaveHandler: (() => void) | undefined;

    function bindClicks() {
      if (!mapStyleReady(map) || clickHandler) return;
      clickHandler = (e: any) => {
        if (!interactiveRef.current || !onSelectRef.current) return;
        const f = e?.features?.[0];
        if (!f) return;
        e.originalEvent?.stopPropagation?.();
        const warning = propsFromFeature(f);
        if (warning) onSelectRef.current(warning);
      };
      enterHandler = () => {
        if (!interactiveRef.current) return;
        map.getCanvas().style.cursor = 'pointer';
      };
      leaveHandler = () => {
        map.getCanvas().style.cursor = '';
      };
      for (const lid of LAYER_IDS) {
        if (!safeGetLayer(map, lid)) continue;
        map.on('click', lid, clickHandler);
        map.on('mouseenter', lid, enterHandler);
        map.on('mouseleave', lid, leaveHandler);
      }
    }

    async function load() {
      if (!mapStyleReady(map) || cancelled) return;
      try {
        const { data } = await axios.get(`${apiBase}/api/navwarnings?scope=all`, {
          timeout: 25000,
        });
        if (cancelled) return;
        const payload = data?.data ?? data ?? {};
        const features = Array.isArray(payload?.features)
          ? payload.features
          : Array.isArray(payload)
            ? payload
            : [];
        const gj = {
          type: 'FeatureCollection',
          features: features.filter((f: any) => f?.geometry),
        } as any;

        if (!safeGetSource(map, id)) {
          map.addSource(id, { type: 'geojson', data: gj });
          map.addLayer({
            id: `${id}-fill`,
            type: 'fill',
            source: id,
            filter: buildLayerFilter(`${id}-fill`, null),
            paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.22 },
            layout: { visibility: 'none' },
          });
          map.addLayer({
            id: `${id}-line`,
            type: 'line',
            source: id,
            filter: buildLayerFilter(`${id}-line`, null),
            paint: {
              'line-color': '#ef4444',
              'line-width': 2,
              'line-dasharray': [2, 2],
            },
            layout: { visibility: 'none' },
          });
          map.addLayer({
            id: `${id}-point`,
            type: 'circle',
            source: id,
            filter: buildLayerFilter(`${id}-point`, null),
            paint: {
              'circle-radius': 7,
              'circle-color': '#ef4444',
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#fff',
              'circle-opacity': 0.5,
              'circle-stroke-opacity': 0.5,
            },
            layout: { visibility: 'none' },
          });
          map.addLayer({
            id: `${id}-label`,
            type: 'symbol',
            source: id,
            filter: buildLayerFilter(`${id}-label`, null),
            layout: {
              visibility: 'none',
              'text-field': ['get', 'title'],
              'text-size': 11,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-optional': true,
            },
            paint: {
              'text-color': '#fecaca',
              'text-halo-color': 'rgba(0,0,0,0.75)',
              'text-halo-width': 1.2,
              'text-opacity': 0.5,
            },
          });
          bindClicks();
        } else {
          const src: any = safeGetSource(map, id);
          src?.setData?.(gj);
          bindClicks();
        }
        applyVisibilityAndFilter();
        console.log(
          `[IncidentLayer] nav warnings features=${gj.features.length}`,
          payload?.meta || ''
        );
      } catch (e) {
        console.warn('[IncidentLayer] nav warnings failed', e);
      }
    }

    load();
    map.once('idle', load);
    const interval = setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      map.off('idle', load);
      if (clickHandler) {
        for (const lid of LAYER_IDS) {
          map.off('click', lid, clickHandler);
          if (enterHandler) map.off('mouseenter', lid, enterHandler);
          if (leaveHandler) map.off('mouseleave', lid, leaveHandler);
        }
      }
      if (!mapStyleReady(map)) return;
      try {
        for (const lid of [...LAYER_IDS].reverse()) {
          if (safeGetLayer(map, lid)) map.removeLayer(lid);
        }
        if (safeGetSource(map, id)) map.removeSource(id);
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, apiBase]);

  useEffect(() => {
    applyVisibilityAndFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, showActive, showRecent30d]);

  return null;
}

function buildLayerFilter(layerId: string, recentFilter: any | null): any {
  let geom: any = null;
  if (layerId.endsWith('-fill')) {
    geom = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
  } else if (layerId.endsWith('-line')) {
    geom = [
      'in',
      ['geometry-type'],
      ['literal', ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']],
    ];
  } else if (layerId.endsWith('-point')) {
    geom = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
  }
  // labels: no geometry filter
  if (!geom && !recentFilter) return null;
  if (!geom) return recentFilter;
  if (!recentFilter) return geom;
  return ['all', geom, recentFilter];
}
