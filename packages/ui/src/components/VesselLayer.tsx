'use client';

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from '../hooks/useMap';
import axios from 'axios';
import {
  mmsiCategory,
  mmsiFlagCountry,
  countryInfoFromMmsi,
  HEADER_COLORS,
  type VesselCategory,
  type FlagCountry,
} from '../utils/vesselCategory';
import {
  vesselPassesFilter,
  type VesselFilterFlags,
  DEFAULT_VESSEL_FILTERS,
} from '../utils/vesselFilters';
import { resolveShipClass } from '../utils/shipClass';
import { buildVesselHoverHtml } from '../utils/vesselHover';
import { buildProjectionRingFeatures } from '../utils/projectionRings';

export type VesselFeatureProps = {
  mmsi: string;
  name: string;
  label: string;
  category: VesselCategory;
  /** Flag / MID country — used by country filters (military/research still have a flag). */
  flagCountry: FlagCountry;
  /** Coarse AIS type bucket for ship-type filters. */
  shipClass: string;
  speed: number | null;
  imo: string | null;
  course: number | null;
  heading: number | null;
  destination: string | null;
  shipType: string | null;
  status: string | number | null;
  eta: string | null;
  timestamp: string | null;
  /** AIS feed id when known (aisstream, barentswatch, …). */
  source: string | null;
  sanctioned: number;
  shadowfleet: number;
  military: number;
  research: number;
  country: string;
  flag: string;
  lon: number | null;
  lat: number | null;
};

export type VesselLayerStatus = {
  vesselCount: number;
  lastUpdate: string | null;
  error: string | null;
  trackStatus: 'idle' | 'loading' | 'ready' | 'error';
  trackError: string | null;
  trackDays?: number;
};

type Props = {
  onVesselSelect?: (vessel: VesselFeatureProps) => void;
  onDeselect?: () => void;
  onStatus?: (status: VesselLayerStatus) => void;
  onVesselsChange?: (vessels: VesselFeatureProps[]) => void;
  selectedMmsi?: string | null;
  visible?: boolean;
  /** When false, ship/background clicks are ignored (e.g. AOI draw mode). */
  interactive?: boolean;
  filters?: VesselFilterFlags;
  /** Historic track lookback 1–14 days (BarentsWatch free open data). */
  trackDays?: number;
  /** Fly map camera when selecting a vessel with known coords. */
  flyToSelected?: boolean;
  /** Watchlist MMSIs — used when filters.watchlistOnly is on. */
  watchlistMmsis?: ReadonlySet<string> | string[];
};

const MARKER_IMAGES: { name: string; url: string }[] = [
  { name: 'Norwaycircle', url: '/markers/Circles/Norwaycircle.svg' },
  { name: 'Russiacircle', url: '/markers/Circles/Russiacircle.svg' },
  { name: 'EUcircle', url: '/markers/Circles/EUcircle.svg' },
  { name: 'Chinacircle', url: '/markers/Circles/Chinacircle.svg' },
  { name: 'Unknowncircle', url: '/markers/Circles/Unknowncircle.svg' },
  { name: 'Militarycircle', url: '/markers/Circles/Militarycircle.svg' },
  { name: 'Researchcircle', url: '/markers/Circles/Researchcircle.svg' },
  { name: 'Sanksjon', url: '/markers/Circles/Sanksjon.svg' },
  { name: 'ShadowTriangle', url: '/markers/Circles/shadowtriangle.svg' },
  { name: 'Norwaytriangle', url: '/markers/Countries/Norwaytriangle.svg' },
  { name: 'Russiatriangle', url: '/markers/Countries/Russiatriangle.svg' },
  { name: 'EUtriangle', url: '/markers/Countries/EUtriangle.svg' },
  { name: 'Chinatriangle', url: '/markers/Countries/Chinatriangle.svg' },
  { name: 'Unknowntriangle', url: '/markers/Countries/Unknowntriangle.svg' },
  { name: 'Militarytriangle', url: '/markers/Countries/Militarytriangle.svg' },
  { name: 'Researchtriangle', url: '/markers/Countries/Researchtriangle.svg' },
];

function iconForCategoryCircle() {
  return [
    'case',
    ['==', ['get', 'category'], 'research'],
    'Researchcircle',
    ['==', ['get', 'category'], 'military'],
    'Militarycircle',
    ['==', ['get', 'category'], 'norway'],
    'Norwaycircle',
    ['==', ['get', 'category'], 'russia'],
    'Russiacircle',
    ['==', ['get', 'category'], 'china'],
    'Chinacircle',
    ['==', ['get', 'category'], 'eu'],
    'EUcircle',
    'Unknowncircle',
  ] as any;
}

function iconForCategoryTriangle() {
  return [
    'case',
    ['==', ['get', 'category'], 'research'],
    'Researchtriangle',
    ['==', ['get', 'category'], 'military'],
    'Militarytriangle',
    ['==', ['get', 'category'], 'norway'],
    'Norwaytriangle',
    ['==', ['get', 'category'], 'russia'],
    'Russiatriangle',
    ['==', ['get', 'category'], 'china'],
    'Chinatriangle',
    ['==', ['get', 'category'], 'eu'],
    'EUtriangle',
    'Unknowntriangle',
  ] as any;
}

/** Rasterize Mapmarkers SVGs so MapLibre gets real pixel dimensions (viewBox-only SVGs often fail). */
async function loadIcon(
  map: {
    hasImage: (name: string) => boolean;
    addImage: (
      name: string,
      image: HTMLImageElement | ImageData | { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let svg = await res.text();
    // Force explicit size so the browser rasterizes at usable resolution
    if (!/\swidth\s*=/.test(svg)) {
      svg = svg.replace(/<svg\b/, `<svg width="${SIZE}" height="${SIZE}"`);
    }
    // Inline CSS class fills — some raster paths drop <style> rules
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
          if (ctx) {
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.drawImage(img, 0, 0, SIZE, SIZE);
            const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
            if (!map.hasImage(name)) {
              map.addImage(name, imageData, { sdf: false, pixelRatio: 2 });
            }
          } else if (!map.hasImage(name)) {
            map.addImage(name, img, { sdf: false });
          }
        } catch (e) {
          console.error('[VesselLayer] addImage failed', name, e);
        }
        URL.revokeObjectURL(objectUrl);
        resolve();
      };
      img.onerror = () => {
        console.error('[VesselLayer] Failed to load icon', url);
        URL.revokeObjectURL(objectUrl);
        resolve();
      };
      img.src = objectUrl;
    });
  } catch (e) {
    console.error('[VesselLayer] Failed to fetch icon', url, e);
  }
}

function toFeature(v: any) {
  const lon = Number(v.lon ?? v.longitude);
  const lat = Number(v.lat ?? v.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const mmsi = String(v.mmsi ?? '');
  const shipType = v.shipType ?? null;
  const imo =
    v.imo != null && v.imo !== '' ? String(v.imo) : null;
  const category = mmsiCategory(mmsi, shipType, imo);
  const flagCountry = mmsiFlagCountry(mmsi);
  const country = countryInfoFromMmsi(mmsi);
  const shipClass = resolveShipClass(shipType, v.shipTypeCode ?? null);
  const headingRaw = v.heading ?? v.course ?? null;
  const heading =
    headingRaw == null || headingRaw === '' || Number(headingRaw) === 511
      ? null
      : Number(headingRaw);

  const props: VesselFeatureProps = {
    mmsi,
    name: v.vessel_name || v.name || '',
    label: v.vessel_name || v.name || `MMSI ${mmsi}`,
    category,
    flagCountry,
    shipClass,
    speed: v.speed ?? null,
    imo,
    course: v.course ?? null,
    heading,
    destination: v.destination || null,
    shipType: typeof shipType === 'string' ? shipType : shipType != null ? String(shipType) : null,
    status: v.status ?? null,
    eta: v.eta || null,
    timestamp: v.timestamp || null,
    source: v.source != null && v.source !== '' ? String(v.source) : null,
    sanctioned: v.sanctioned === true ? 1 : 0,
    shadowfleet: v.shadowfleet === true ? 1 : 0,
    military: category === 'military' || v.military === true ? 1 : 0,
    research: category === 'research' ? 1 : 0,
    country: country.name,
    flag: country.iso,
    lon,
    lat,
  };

  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] },
    properties: props,
  };
}

/**
 * Live AIS markers using Mapmarkers SVGs:
 * - small circles when zoomed out
 * - heading triangles when zoomed in (>= ~7)
 */
export default function VesselLayer({
  onVesselSelect,
  onDeselect,
  onStatus,
  onVesselsChange,
  selectedMmsi = null,
  visible = true,
  interactive = true,
  filters = DEFAULT_VESSEL_FILTERS,
  trackDays = 1,
  flyToSelected = true,
  watchlistMmsis,
}: Props) {
  const map = useMap();
  const apiBase =
    (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:8787';
  const onSelectRef = useRef(onVesselSelect);
  onSelectRef.current = onVesselSelect;
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onVesselsRef = useRef(onVesselsChange);
  onVesselsRef.current = onVesselsChange;
  const clearTrackRef = useRef<(() => void) | null>(null);
  const showTrackRef = useRef<((mmsi: string) => Promise<void>) | null>(null);
  const showProjectionRef = useRef<((mmsi: string) => void) | null>(null);
  const clearProjectionRef = useRef<(() => void) | null>(null);
  const vesselsByMmsiRef = useRef<Map<string, VesselFeatureProps>>(new Map());
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const trackDaysRef = useRef(trackDays);
  trackDaysRef.current = trackDays;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const watchlistRef = useRef<ReadonlySet<string>>(new Set());
  if (watchlistMmsis instanceof Set) {
    watchlistRef.current = watchlistMmsis;
  } else if (Array.isArray(watchlistMmsis)) {
    watchlistRef.current = new Set(watchlistMmsis.map(String));
  } else {
    watchlistRef.current = new Set();
  }
  const selectedMmsiRef = useRef(selectedMmsi);
  selectedMmsiRef.current = selectedMmsi;
  const applyFilterRef = useRef<(() => void) | null>(null);
  const allFeaturesRef = useRef<any[]>([]);

  useEffect(() => {
    const sourceId = 'ships';
    let interval: ReturnType<typeof setInterval> | undefined;
    let destroyed = false;
    let clickHandler: ((e: any) => void) | undefined;
    let hoverEnterHandler: ((e: any) => void) | undefined;
    let hoverMoveHandler: ((e: any) => void) | undefined;
    let hoverLeaveHandler: (() => void) | undefined;
    let hoverPopup: maplibregl.Popup | null = null;

    const layerIds = [
      'vessels-dot',
      'vessels-circle',
      'vessels-triangle',
      'ships-hit',
      'vessels-label',
      'sanction-indicator',
      'shadow-indicator',
    ];
    const trackSourceId = 'vessel-track';
    const trackLayerIds = ['vessel-track-line', 'vessel-track-points'];
    const projSourceId = 'vessel-projection';
    const projLayerIds = ['vessel-projection-rings', 'vessel-projection-labels'];
    let trackAbort: AbortController | undefined;
    let activeTrackMmsi: string | null = null;
    let bgClickHandler: ((e: any) => void) | undefined;
    let projHoverEnter: ((e: any) => void) | undefined;
    let projHoverLeave: (() => void) | undefined;
    let ringHoverPopup: maplibregl.Popup | null = null;

    const hideHover = () => {
      try {
        hoverPopup?.remove();
      } catch {
        /* ignore */
      }
    };

    const showHover = (feature: any) => {
      if (!interactiveRef.current || !feature?.properties) return;
      const p = feature.properties as Record<string, unknown>;
      const mmsi = String(p.mmsi ?? '');
      if (selectedMmsiRef.current && mmsi === String(selectedMmsiRef.current)) {
        hideHover();
        return;
      }
      const coords = feature.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      const numOrNull = (v: unknown) => {
        if (v == null || v === '' || v === 'null' || v === 'undefined') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const strOrNull = (v: unknown) => {
        if (v == null || v === '' || v === 'null' || v === 'undefined') return null;
        return String(v);
      };

      const html = buildVesselHoverHtml({
        mmsi,
        name: strOrNull(p.name),
        label: strOrNull(p.label),
        category: (p.category as VesselCategory) || 'rest',
        country: strOrNull(p.country),
        flag: strOrNull(p.flag),
        shipType: strOrNull(p.shipType),
        heading: (() => {
          const h = numOrNull(p.heading);
          return h === 511 ? null : h;
        })(),
        course: numOrNull(p.course),
        speed: numOrNull(p.speed),
        destination: strOrNull(p.destination),
        timestamp: strOrNull(p.timestamp),
        source: strOrNull(p.source),
        lon,
        lat,
        sanctioned: Number(p.sanctioned) ? 1 : 0,
        shadowfleet: Number(p.shadowfleet) ? 1 : 0,
      });

      if (!hoverPopup) {
        hoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          className: 'svalmap-ship-hover-popup',
          maxWidth: '280px',
          anchor: 'top',
        });
      }
      hoverPopup.setLngLat([lon, lat]).setHTML(html).addTo(map);
    };

    let lastStatus: VesselLayerStatus = {
      vesselCount: 0,
      lastUpdate: null,
      error: null,
      trackStatus: 'idle',
      trackError: null,
    };
    const emitStatus = (partial: Partial<VesselLayerStatus>) => {
      lastStatus = { ...lastStatus, ...partial };
      onStatusRef.current?.(lastStatus);
    };

    // Tiny solid dots through ~z4.7, then a long smooth handoff to marker icons.
    const dotRadius: any = [
      'interpolate',
      ['linear'],
      ['zoom'],
      1,
      2.4,
      4.7,
      2.6,
      6.8,
      4.2,
    ];
    const dotOpacity: any = [
      'interpolate',
      ['linear'],
      ['zoom'],
      4.7,
      0.95,
      6.8,
      0,
    ];
    const dotColor: any = [
      'match',
      ['get', 'category'],
      'norway',
      HEADER_COLORS.norway,
      'russia',
      HEADER_COLORS.russia,
      'eu',
      HEADER_COLORS.eu,
      'china',
      HEADER_COLORS.china,
      'military',
      HEADER_COLORS.military,
      'research',
      HEADER_COLORS.research,
      HEADER_COLORS.rest,
    ];
    // Marker icons: fade/grow in from z4.7 over ~2 zoom levels
    const circleSize: any = [
      'interpolate',
      ['linear'],
      ['zoom'],
      4.7,
      0.18,
      5.8,
      0.3,
      6.8,
      0.45,
      8.5,
      0.58,
    ];
    // Triangles take over later so mid-zoom stays as circles
    const triangleSize: any = ['interpolate', ['linear'], ['zoom'], 6, 0.35, 8, 0.55, 10, 0.7];
    const circleOpacity: any = [
      'interpolate',
      ['linear'],
      ['zoom'],
      4.7,
      0,
      6.8,
      1,
      7.5,
      0,
    ];
    const triangleOpacity: any = ['interpolate', ['linear'], ['zoom'], 6.8, 0, 7.5, 1];
    // Names start a bit after heading triangles, then fade in over ~1 zoom
    const labelOpacity: any = ['interpolate', ['linear'], ['zoom'], 7.5, 0, 8.5, 1];
    // Sanction / shadow badges — 50% larger than base vessel markers for scanability
    const badgeSize: any = [
      'interpolate',
      ['linear'],
      ['zoom'],
      2,
      0.57,
      5,
      0.75,
      8,
      0.93,
    ];
    const badgeTranslate: any = [0, -24];

    function setLayersVisible(on: boolean) {
      const v = on ? 'visible' : 'none';
      for (const id of layerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
      }
    }

    function clearTrack() {
      trackAbort?.abort();
      trackAbort = undefined;
      activeTrackMmsi = null;
      try {
        const src = map.getSource(trackSourceId) as any;
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        for (const id of trackLayerIds) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }
      } catch {
        /* ignore */
      }
      emitStatus({ trackStatus: 'idle', trackError: null });
    }
    clearTrackRef.current = clearTrack;

    function clearProjection() {
      try {
        ringHoverPopup?.remove();
      } catch {
        /* ignore */
      }
      try {
        const src = map.getSource(projSourceId) as any;
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        for (const id of projLayerIds) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }
      } catch {
        /* ignore */
      }
    }
    clearProjectionRef.current = clearProjection;

    function ensureProjectionLayers() {
      if (!map.getSource(projSourceId)) {
        map.addSource(projSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('vessel-projection-rings')) {
        map.addLayer({
          id: 'vessel-projection-rings',
          type: 'line',
          source: projSourceId,
          layout: {
            visibility: 'none',
            'line-cap': 'butt',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#cbd5e1',
            'line-width': 1.1,
            'line-dasharray': [1.2, 2.2],
            'line-opacity': 0.85,
          },
        });
      }
      if (!map.getLayer('vessel-projection-labels')) {
        map.addLayer({
          id: 'vessel-projection-labels',
          type: 'symbol',
          source: projSourceId,
          layout: {
            visibility: 'none',
            'symbol-placement': 'line',
            'symbol-spacing': 280,
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['NRK Sans Regular', 'Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-max-angle': 30,
            'text-pitch-alignment': 'viewport',
            'text-rotation-alignment': 'map',
          },
          paint: {
            'text-color': '#e2e8f0',
            'text-halo-color': 'rgba(11, 18, 32, 0.92)',
            'text-halo-width': 1.2,
          },
        });
      }
      if (!projHoverEnter) {
        projHoverEnter = (e: any) => {
          const f = e.features?.[0];
          if (!f?.properties) return;
          map.getCanvas().style.cursor = 'pointer';
          const short =
            String(f.properties.shortLabel || f.properties.label || '').trim();
          if (!short) return;
          const coords = e.lngLat;
          if (!ringHoverPopup) {
            ringHoverPopup = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              offset: 8,
              className: 'svalmap-ring-hover-popup',
              maxWidth: '200px',
            });
          }
          ringHoverPopup
            .setLngLat(coords)
            .setHTML(
              `<div class="svalmap-ring-tip">${short
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')}</div>`
            )
            .addTo(map);
        };
        projHoverLeave = () => {
          map.getCanvas().style.cursor = '';
          try {
            ringHoverPopup?.remove();
          } catch {
            /* ignore */
          }
        };
        map.on('mouseenter', 'vessel-projection-rings', projHoverEnter);
        map.on('mousemove', 'vessel-projection-rings', projHoverEnter);
        map.on('mouseleave', 'vessel-projection-rings', projHoverLeave!);
      }
    }

    function showProjection(mmsi: string) {
      if (!mmsi) {
        clearProjection();
        return;
      }
      const v = vesselsByMmsiRef.current.get(mmsi);
      if (
        !v ||
        v.lon == null ||
        v.lat == null ||
        !Number.isFinite(v.lon) ||
        !Number.isFinite(v.lat)
      ) {
        clearProjection();
        return;
      }
      ensureProjectionLayers();
      const features = buildProjectionRingFeatures(v.lon, v.lat, v.speed);
      const src = map.getSource(projSourceId) as any;
      if (src) src.setData({ type: 'FeatureCollection', features });
      const vis = features.length ? 'visible' : 'none';
      for (const id of projLayerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
      try {
        // Keep rings under ship markers but above track
        if (map.getLayer('ships-hit')) {
          map.moveLayer('vessel-projection-rings', 'ships-hit');
          map.moveLayer('vessel-projection-labels', 'ships-hit');
        }
      } catch {
        /* ignore */
      }
    }
    showProjectionRef.current = showProjection;

    function ensureTrackLayers() {
      if (!map.getSource(trackSourceId)) {
        map.addSource(trackSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('vessel-track-line')) {
        map.addLayer({
          id: 'vessel-track-line',
          type: 'line',
          source: trackSourceId,
          filter: ['==', ['get', 'kind'], 'track'],
          layout: {
            visibility: 'none',
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#f6a21a',
            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 2.5, 12, 3.5],
            'line-opacity': 0.9,
          },
        });
      }
      if (!map.getLayer('vessel-track-points')) {
        map.addLayer({
          id: 'vessel-track-points',
          type: 'circle',
          source: trackSourceId,
          filter: ['==', ['get', 'kind'], 'point'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 3.5],
            'circle-color': '#f6a21a',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff',
            'circle-opacity': 0.85,
          },
        });
      }
    }

    async function showTrack(mmsi: string) {
      if (!mmsi) return;
      ensureTrackLayers();
      const days = Math.max(1, Math.min(14, trackDaysRef.current || 1));
      // Always refetch when days change even for same MMSI
      clearTrack();
      activeTrackMmsi = mmsi;
      emitStatus({ trackStatus: 'loading', trackError: null, trackDays: days });
      const controller = new AbortController();
      trackAbort = controller;
      try {
        const { data } = await axios.get(`${apiBase}/api/tracks24h`, {
          params: { mmsi, interval: days > 3 ? 30 : 15, days },
          timeout: 60000,
          signal: controller.signal as any,
        });
        if (destroyed || activeTrackMmsi !== mmsi) return;
        const features: any[] = [];
        const coords = data?.line?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { kind: 'track', mmsi },
          });
        }
        const pts = data?.points?.features;
        if (Array.isArray(pts)) {
          for (const f of pts) {
            if (!f?.geometry?.coordinates) continue;
            features.push({
              type: 'Feature',
              geometry: f.geometry,
              properties: { kind: 'point', mmsi, time: f.properties?.time || null },
            });
          }
        }
        const src = map.getSource(trackSourceId) as any;
        if (src) src.setData({ type: 'FeatureCollection', features });
        for (const id of trackLayerIds) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
        }
        try {
          if (map.getLayer('ships-hit')) {
            map.moveLayer('vessel-track-line', 'ships-hit');
            map.moveLayer('vessel-track-points', 'ships-hit');
          }
        } catch {
          /* ignore */
        }
        emitStatus({
          trackStatus: features.length ? 'ready' : 'error',
          trackError: features.length
            ? null
            : `No track points in last ${days}d (Norwegian historic coverage)`,
          trackDays: days,
        });
      } catch (e: any) {
        if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
        console.warn('[VesselLayer] track fetch failed', mmsi, e?.message || e);
        emitStatus({ trackStatus: 'error', trackError: e?.message || 'Track unavailable' });
      }
    }
    showTrackRef.current = showTrack;

    function applyFeatureFilter() {
      const f = filtersRef.current;
      const all = allFeaturesRef.current;
      const extras = { watchlistMmsis: watchlistRef.current };
      const features = all.filter((feat) =>
        vesselPassesFilter(feat?.properties || {}, f, extras)
      );
      const src = map.getSource(sourceId) as any;
      if (src) {
        src.setData({ type: 'FeatureCollection', features });
      }
      emitStatus({ vesselCount: features.length });
    }
    applyFilterRef.current = applyFeatureFilter;

    function applyMarkerStyles() {
      if (map.getLayer('vessels-dot')) {
        map.setPaintProperty('vessels-dot', 'circle-radius', dotRadius);
        map.setPaintProperty('vessels-dot', 'circle-color', dotColor);
        map.setPaintProperty('vessels-dot', 'circle-opacity', dotOpacity);
        map.setLayerZoomRange('vessels-dot', 0, 7.2);
      }
      if (map.getLayer('vessels-circle')) {
        map.setLayoutProperty('vessels-circle', 'icon-image', iconForCategoryCircle());
        map.setLayoutProperty('vessels-circle', 'icon-size', circleSize);
        map.setPaintProperty('vessels-circle', 'icon-opacity', circleOpacity);
        map.setLayerZoomRange('vessels-circle', 4.7, 24);
      }
      if (map.getLayer('vessels-triangle')) {
        map.setLayoutProperty('vessels-triangle', 'icon-image', iconForCategoryTriangle());
        map.setLayoutProperty('vessels-triangle', 'icon-size', triangleSize);
        map.setPaintProperty('vessels-triangle', 'icon-opacity', triangleOpacity);
      }
      if (map.getLayer('vessels-label')) {
        map.setLayoutProperty('vessels-label', 'text-font', ['NRK Sans Medium']);
        map.setLayoutProperty('vessels-label', 'text-size', 12);
        map.setLayoutProperty('vessels-label', 'text-allow-overlap', true);
        map.setLayoutProperty('vessels-label', 'text-ignore-placement', true);
        map.setLayoutProperty('vessels-label', 'text-optional', true);
        map.setPaintProperty('vessels-label', 'text-opacity', labelOpacity);
        map.setLayerZoomRange('vessels-label', 7.5, 24);
      }
      if (map.getLayer('sanction-indicator')) {
        map.setLayoutProperty('sanction-indicator', 'icon-size', badgeSize);
        map.setPaintProperty('sanction-indicator', 'icon-translate', badgeTranslate);
      }
      if (map.getLayer('shadow-indicator')) {
        map.setLayoutProperty('shadow-indicator', 'icon-size', badgeSize);
        map.setPaintProperty('shadow-indicator', 'icon-translate', badgeTranslate);
      }
    }

    async function ensureLayers() {
      await Promise.all(MARKER_IMAGES.map((i) => loadIcon(map, i.name, i.url)));
      if (destroyed) return;

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }

      if (!map.getLayer('vessels-dot')) {
        map.addLayer({
          id: 'vessels-dot',
          type: 'circle',
          source: sourceId,
          maxzoom: 7.2,
          paint: {
            'circle-radius': dotRadius,
            'circle-color': dotColor,
            'circle-opacity': dotOpacity,
            'circle-stroke-width': 0,
          },
        });
      }

      if (!map.getLayer('vessels-circle')) {
        map.addLayer({
          id: 'vessels-circle',
          type: 'symbol',
          source: sourceId,
          minzoom: 4.7,
          layout: {
            'icon-image': iconForCategoryCircle(),
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-size': circleSize,
          },
          paint: {
            'icon-opacity': circleOpacity,
          },
        });
      }

      if (!map.getLayer('vessels-triangle')) {
        map.addLayer({
          id: 'vessels-triangle',
          type: 'symbol',
          source: sourceId,
          layout: {
            'icon-image': iconForCategoryTriangle(),
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotate': ['coalesce', ['get', 'heading'], ['get', 'course'], 0],
            'icon-rotation-alignment': 'map',
            'icon-size': triangleSize,
          },
          paint: {
            'icon-opacity': triangleOpacity,
          },
        });
      }

      if (!map.getLayer('ships-hit')) {
        map.addLayer({
          id: 'ships-hit',
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 10, 7, 16, 10, 20],
            'circle-color': '#000',
            'circle-opacity': 0,
          },
        });
      }

      if (!map.getLayer('vessels-label')) {
        map.addLayer({
          id: 'vessels-label',
          type: 'symbol',
          source: sourceId,
          // Slightly past heading-triangle zoom, then fade in
          minzoom: 7.5,
          layout: {
            'text-field': ['coalesce', ['get', 'name'], ['get', 'label']],
            'text-font': ['NRK Sans Medium'],
            'text-size': 12,
            'text-offset': [0, 1.35],
            'text-anchor': 'top',
            'text-optional': true,
            // Dense AIS clusters otherwise hide almost every name
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0, 0, 0, 0.85)',
            'text-halo-width': 1.5,
            'text-opacity': labelOpacity,
          },
        });
      }

      ensureTrackLayers();

      if (!map.getLayer('sanction-indicator')) {
        map.addLayer({
          id: 'sanction-indicator',
          type: 'symbol',
          source: sourceId,
          layout: {
            'icon-image': 'Sanksjon',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-size': badgeSize,
            'icon-anchor': 'center',
          },
          paint: {
            'icon-opacity': ['case', ['==', ['get', 'sanctioned'], 1], 1, 0],
            'icon-translate': badgeTranslate,
            'icon-translate-anchor': 'viewport',
          },
        });
      }

      if (!map.getLayer('shadow-indicator')) {
        map.addLayer({
          id: 'shadow-indicator',
          type: 'symbol',
          source: sourceId,
          layout: {
            'icon-image': 'ShadowTriangle',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-size': badgeSize,
            'icon-anchor': 'center',
          },
          paint: {
            'icon-opacity': ['case', ['==', ['get', 'shadowfleet'], 1], 1, 0],
            'icon-translate': badgeTranslate,
            'icon-translate-anchor': 'viewport',
          },
        });
      }

      // Drop legacy selection ring if present (HMR / older builds)
      if (map.getLayer('vessel-selected')) {
        map.removeLayer('vessel-selected');
      }

      // Keep styles in sync after HMR / remount without tearing down layers
      applyMarkerStyles();

      // Drop leftover MapLibre layer filters from older setFilter-based builds
      for (const id of layerIds) {
        if (!map.getLayer(id)) continue;
        try {
          map.setFilter(id, null as any);
        } catch {
          /* ignore */
        }
      }

      if (!clickHandler) {
        clickHandler = (e: any) => {
          if (!interactiveRef.current) return;
          const f = e.features?.[0];
          if (!f?.properties || !onSelectRef.current) return;
          e.originalEvent?.stopPropagation?.();
          hideHover();
          const p = f.properties as Record<string, unknown>;
          const numOrNull = (v: unknown) => {
            if (v == null || v === '' || v === 'null' || v === 'undefined') return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };
          const strOrEmpty = (v: unknown) => {
            if (v == null || v === 'null' || v === 'undefined') return '';
            return String(v);
          };
          const strOrNull = (v: unknown) => {
            const s = strOrEmpty(v);
            return s === '' ? null : s;
          };
          const mmsi = String(p.mmsi ?? '');
          const coords = f.geometry?.coordinates;
          const lon = Array.isArray(coords) ? Number(coords[0]) : null;
          const lat = Array.isArray(coords) ? Number(coords[1]) : null;
          onSelectRef.current({
            mmsi,
            name: strOrEmpty(p.name),
            label: strOrEmpty(p.label) || strOrEmpty(p.name) || `MMSI ${p.mmsi}`,
            category: (p.category as VesselCategory) || 'rest',
            flagCountry:
              (p.flagCountry as FlagCountry) ||
              mmsiFlagCountry(mmsi),
            shipClass: strOrEmpty(p.shipClass) || resolveShipClass(strOrNull(p.shipType)),
            speed: numOrNull(p.speed),
            imo: strOrNull(p.imo),
            course: numOrNull(p.course),
            heading: (() => {
              const h = numOrNull(p.heading);
              return h === 511 ? null : h;
            })(),
            destination: strOrNull(p.destination),
            shipType: strOrNull(p.shipType),
            status: p.status == null || p.status === '' || p.status === 'null' ? null : p.status as string | number,
            eta: strOrNull(p.eta),
            timestamp: strOrNull(p.timestamp),
            source: strOrNull(p.source),
            sanctioned: Number(p.sanctioned) ? 1 : 0,
            shadowfleet: Number(p.shadowfleet) ? 1 : 0,
            military: Number(p.military) ? 1 : 0,
            research: Number(p.research) ? 1 : 0,
            country: strOrEmpty(p.country) || 'Unknown',
            flag: strOrEmpty(p.flag) || 'xx',
            lon: Number.isFinite(lon as number) ? (lon as number) : null,
            lat: Number.isFinite(lat as number) ? (lat as number) : null,
          });
        };
        map.on('click', 'ships-hit', clickHandler);
        hoverEnterHandler = (e: any) => {
          if (!interactiveRef.current) return;
          map.getCanvas().style.cursor = 'pointer';
          if (e.features?.[0]) showHover(e.features[0]);
        };
        hoverMoveHandler = (e: any) => {
          if (!interactiveRef.current) return;
          if (e.features?.[0]) showHover(e.features[0]);
        };
        hoverLeaveHandler = () => {
          map.getCanvas().style.cursor = '';
          hideHover();
        };
        map.on('mouseenter', 'ships-hit', hoverEnterHandler);
        map.on('mousemove', 'ships-hit', hoverMoveHandler);
        map.on('mouseleave', 'ships-hit', hoverLeaveHandler);
      }

      if (!bgClickHandler) {
        bgClickHandler = (e: any) => {
          if (!interactiveRef.current) return;
          // Don't clear selection when the click hit another interactive overlay
          // (GFW events, cables, nav warnings) — those handlers open their own detail.
          const overlayLayerIds = [
            'gfw-events-hit',
            'gfw-detections-hit',
            'gfw-loitering',
            'gfw-encounters-point',
            'gfw-aisoff',
            'gfw-port',
            'gfw-sar-unmatched',
            'gfw-sar-matched',
            'gfw-viirs',
            'gfw-sanction-badge',
            'gfw-shadow-badge',
            'overlay-cables-hit',
            'overlay-cables-telegeography-hit',
            'overlay-tg-landings-circle',
            'overlay-ports-hit',
            'overlay-ports-circle',
            'overlay-petroleum-points-hit',
            'overlay-petroleum-points-circle',
            'overlay-pipelines-hit',
            'overlay-pipelines-old-hit',
            'nav-warnings-fill',
            'nav-warnings-line',
            'nav-warnings-point',
            'nav-warnings-label',
            'ships-hit',
            'vessel-projection-rings',
            'vessel-projection-labels',
          ].filter((id) => map.getLayer(id));
          const hits = overlayLayerIds.length
            ? map.queryRenderedFeatures(e.point, { layers: overlayLayerIds })
            : [];
          if (hits.length) return;
          clearTrack();
          onDeselectRef.current?.();
        };
        map.on('click', bgClickHandler);
      }

      setLayersVisible(visibleRef.current);
    }

    async function refresh() {
      try {
        await ensureLayers();
        if (destroyed) return;
        const { data } = await axios.get(`${apiBase}/api/live-positions`, {
          timeout: 30000,
        });
        const list = Array.isArray(data) ? data : data?.data || [];
        const features = list.map(toFeature).filter(Boolean);
        allFeaturesRef.current = features as any[];
        const byMmsi = new Map<string, VesselFeatureProps>();
        for (const f of features as any[]) {
          if (f?.properties?.mmsi) byMmsi.set(String(f.properties.mmsi), f.properties);
        }
        vesselsByMmsiRef.current = byMmsi;
        onVesselsRef.current?.(Array.from(byMmsi.values()));
        applyFeatureFilter();
        const sel = selectedMmsiRef.current;
        if (sel) showProjection(sel);
        emitStatus({
          lastUpdate: new Date().toISOString(),
          error: null,
        });
      } catch (e: any) {
        console.error('[VesselLayer] Failed to load AIS:', e);
        emitStatus({
          error: e?.message || 'AIS update failed',
        });
      }
    }

    const start = () => {
      refresh();
      if (!interval) {
        // Quick follow-up so BarentsWatch merge lands soon after AISStream-first paint
        setTimeout(() => {
          if (!destroyed) refresh();
        }, 3000);
        interval = setInterval(refresh, 20 * 1000);
      }
    };

    start();
    map.once('load', start);
    map.once('idle', start);

    return () => {
      destroyed = true;
      trackAbort?.abort();
      clearTrackRef.current = null;
      if (interval) clearInterval(interval);
      map.off('load', start);
      map.off('idle', start);
      if (clickHandler) {
        map.off('click', 'ships-hit', clickHandler);
      }
      if (hoverEnterHandler) map.off('mouseenter', 'ships-hit', hoverEnterHandler);
      if (hoverMoveHandler) map.off('mousemove', 'ships-hit', hoverMoveHandler);
      if (hoverLeaveHandler) map.off('mouseleave', 'ships-hit', hoverLeaveHandler);
      hideHover();
      hoverPopup = null;
      if (projHoverEnter) {
        map.off('mouseenter', 'vessel-projection-rings', projHoverEnter);
        map.off('mousemove', 'vessel-projection-rings', projHoverEnter);
      }
      if (projHoverLeave) map.off('mouseleave', 'vessel-projection-rings', projHoverLeave);
      clearProjection();
      try {
        ringHoverPopup?.remove();
      } catch {
        /* ignore */
      }
      ringHoverPopup = null;
      if (bgClickHandler) {
        map.off('click', bgClickHandler);
      }
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [...trackLayerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [...projLayerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getSource(trackSourceId)) map.removeSource(trackSourceId);
      if (map.getSource(projSourceId)) map.removeSource(projSourceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, apiBase]);

  useEffect(() => {
    const v = visible ? 'visible' : 'none';
    if (!map?.style) return;
    try {
      for (const id of [
        'vessels-dot',
        'vessels-circle',
        'vessels-triangle',
        'ships-hit',
        'vessels-label',
        'sanction-indicator',
        'shadow-indicator',
      ]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
      }
    } catch {
      /* style not ready */
    }
  }, [map, visible]);

  useEffect(() => {
    applyFilterRef.current?.();
  }, [filters, watchlistMmsis]);

  useEffect(() => {
    if (!selectedMmsi) {
      clearTrackRef.current?.();
      clearProjectionRef.current?.();
      return;
    }
    showTrackRef.current?.(selectedMmsi).catch(() => undefined);
    showProjectionRef.current?.(selectedMmsi);
    if (flyToSelected) {
      const v = vesselsByMmsiRef.current.get(selectedMmsi);
      if (v?.lon != null && v?.lat != null && Number.isFinite(v.lon) && Number.isFinite(v.lat)) {
        try {
          map.flyTo({ center: [v.lon, v.lat], zoom: Math.max(map.getZoom(), 7.5), speed: 1.2 });
        } catch {
          /* ignore */
        }
      }
    }
  }, [selectedMmsi, trackDays, flyToSelected, map]);

  return null;
}
