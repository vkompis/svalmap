'use client';

import React, { useEffect, useRef } from 'react';
import { useMap } from '../hooks/useMap';
import axios from 'axios';
import {
  mmsiCategory,
  countryInfoFromMmsi,
  type VesselCategory,
} from '../utils/vesselCategory';

export type VesselFeatureProps = {
  mmsi: string;
  name: string;
  label: string;
  category: VesselCategory;
  speed: number | null;
  imo: string | null;
  course: number | null;
  heading: number | null;
  destination: string | null;
  shipType: string | null;
  status: string | number | null;
  eta: string | null;
  timestamp: string | null;
  sanctioned: number;
  shadowfleet: number;
  military: number;
  country: string;
  flag: string;
};

type Props = {
  onVesselSelect?: (vessel: VesselFeatureProps) => void;
  visible?: boolean;
};

const MARKER_IMAGES: { name: string; url: string }[] = [
  { name: 'Norwaycircle', url: '/markers/Circles/Norwaycircle.svg' },
  { name: 'Russiacircle', url: '/markers/Circles/Russiacircle.svg' },
  { name: 'EUcircle', url: '/markers/Circles/EUcircle.svg' },
  { name: 'Chinacircle', url: '/markers/Circles/Chinacircle.svg' },
  { name: 'Unknowncircle', url: '/markers/Circles/Unknowncircle.svg' },
  { name: 'Militarycircle', url: '/markers/Circles/Militarycircle.svg' },
  { name: 'Sanksjon', url: '/markers/Circles/Sanksjon.svg' },
  { name: 'ShadowTriangle', url: '/markers/Circles/shadowtriangle.svg' },
  { name: 'Norwaytriangle', url: '/markers/Countries/Norwaytriangle.svg' },
  { name: 'Russiatriangle', url: '/markers/Countries/Russiatriangle.svg' },
  { name: 'EUtriangle', url: '/markers/Countries/EUtriangle.svg' },
  { name: 'Chinatriangle', url: '/markers/Countries/Chinatriangle.svg' },
  { name: 'Unknowntriangle', url: '/markers/Countries/Unknowntriangle.svg' },
  { name: 'Militarytriangle', url: '/markers/Countries/Militarytriangle.svg' },
];

function iconForCategoryCircle() {
  return [
    'case',
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
  const category = mmsiCategory(mmsi, shipType);
  const country = countryInfoFromMmsi(mmsi);
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
    speed: v.speed ?? null,
    imo: v.imo != null && v.imo !== '' ? String(v.imo) : null,
    course: v.course ?? null,
    heading,
    destination: v.destination || null,
    shipType: typeof shipType === 'string' ? shipType : shipType != null ? String(shipType) : null,
    status: v.status ?? null,
    eta: v.eta || null,
    timestamp: v.timestamp || null,
    sanctioned: v.sanctioned === true ? 1 : 0,
    shadowfleet: v.shadowfleet === true ? 1 : 0,
    military: category === 'military' || v.military === true ? 1 : 0,
    country: country.name,
    flag: country.iso,
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
export default function VesselLayer({ onVesselSelect, visible = true }: Props) {
  const map = useMap();
  const apiBase =
    (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:8787';
  const onSelectRef = useRef(onVesselSelect);
  onSelectRef.current = onVesselSelect;

  useEffect(() => {
    const sourceId = 'ships';
    let interval: ReturnType<typeof setInterval> | undefined;
    let destroyed = false;
    let clickHandler: ((e: any) => void) | undefined;

    const layerIds = [
      'vessels-circle',
      'vessels-triangle',
      'ships-hit',
      'vessels-label',
      'sanction-indicator',
      'shadow-indicator',
    ];

    // Circles: compact at world/Norway overview, grow gradually
    const circleSize: any = ['interpolate', ['linear'], ['zoom'], 2, 0.16, 4, 0.26, 6, 0.4, 8, 0.55];
    // Triangles take over later so overview stays as dots
    const triangleSize: any = ['interpolate', ['linear'], ['zoom'], 6, 0.35, 8, 0.55, 10, 0.7];
    const circleOpacity: any = ['interpolate', ['linear'], ['zoom'], 6.5, 1, 7.2, 0];
    const triangleOpacity: any = ['interpolate', ['linear'], ['zoom'], 6.5, 0, 7.2, 1];
    // Badges are rasterized to the same 64px atlas as circles — need ~0.4–0.65, not 0.08
    const badgeSize: any = ['interpolate', ['linear'], ['zoom'], 2, 0.38, 5, 0.5, 8, 0.62];

    function setLayersVisible(on: boolean) {
      const v = on ? 'visible' : 'none';
      for (const id of layerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
      }
    }

    function applyMarkerStyles() {
      if (map.getLayer('vessels-circle')) {
        map.setLayoutProperty('vessels-circle', 'icon-size', circleSize);
        map.setPaintProperty('vessels-circle', 'icon-opacity', circleOpacity);
      }
      if (map.getLayer('vessels-triangle')) {
        map.setLayoutProperty('vessels-triangle', 'icon-size', triangleSize);
        map.setPaintProperty('vessels-triangle', 'icon-opacity', triangleOpacity);
      }
      if (map.getLayer('sanction-indicator')) {
        map.setLayoutProperty('sanction-indicator', 'icon-size', badgeSize);
        map.setPaintProperty('sanction-indicator', 'icon-translate', [0, -16]);
      }
      if (map.getLayer('shadow-indicator')) {
        map.setLayoutProperty('shadow-indicator', 'icon-size', badgeSize);
        map.setPaintProperty('shadow-indicator', 'icon-translate', [0, -16]);
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

      if (!map.getLayer('vessels-circle')) {
        map.addLayer({
          id: 'vessels-circle',
          type: 'symbol',
          source: sourceId,
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
          minzoom: 7,
          layout: {
            'text-field': ['coalesce', ['get', 'name'], ['get', 'label']],
            'text-transform': 'uppercase',
            'text-offset': [0, 1.5],
            'text-size': 10,
            'text-font': ['Noto Sans Bold', 'Noto Sans Regular'],
            'text-optional': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1,
          },
        });
      }

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
            'icon-translate': [0, -16],
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
            'icon-translate': [0, -16],
            'icon-translate-anchor': 'viewport',
          },
        });
      }

      // Keep styles in sync after HMR / remount without tearing down layers
      applyMarkerStyles();

      if (!clickHandler) {
        clickHandler = (e: any) => {
          const f = e.features?.[0];
          if (!f?.properties || !onSelectRef.current) return;
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
          onSelectRef.current({
            mmsi: String(p.mmsi ?? ''),
            name: strOrEmpty(p.name),
            label: strOrEmpty(p.label) || strOrEmpty(p.name) || `MMSI ${p.mmsi}`,
            category: (p.category as VesselCategory) || 'rest',
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
            sanctioned: Number(p.sanctioned) ? 1 : 0,
            shadowfleet: Number(p.shadowfleet) ? 1 : 0,
            military: Number(p.military) ? 1 : 0,
            country: strOrEmpty(p.country) || 'Unknown',
            flag: strOrEmpty(p.flag) || 'xx',
          });
        };
        map.on('click', 'ships-hit', clickHandler);
        map.on('mouseenter', 'ships-hit', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'ships-hit', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      setLayersVisible(visible);
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
        const fc = { type: 'FeatureCollection', features };
        const src = map.getSource(sourceId) as any;
        if (src) src.setData(fc);
        console.log(`[VesselLayer] ${features.length} vessels (SVG markers)`);
      } catch (e) {
        console.error('[VesselLayer] Failed to load AIS:', e);
      }
    }

    const start = () => {
      refresh();
      if (!interval) interval = setInterval(refresh, 5 * 60 * 1000);
    };

    start();
    map.once('load', start);
    map.once('idle', start);

    return () => {
      destroyed = true;
      if (interval) clearInterval(interval);
      map.off('load', start);
      map.off('idle', start);
      if (clickHandler) {
        map.off('click', 'ships-hit', clickHandler);
      }
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, apiBase]);

  useEffect(() => {
    const v = visible ? 'visible' : 'none';
    for (const id of [
      'vessels-circle',
      'vessels-triangle',
      'ships-hit',
      'vessels-label',
      'sanction-indicator',
      'shadow-indicator',
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
    }
  }, [map, visible]);

  return null;
}
