'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MapContext } from '../hooks/useMap';

const DEFAULT_STYLE = '/styles/svalmap-dark.json';
const MAPTILER_KEY_PLACEHOLDER = '__MAPTILER_KEY__';

/** North Atlantic monitoring extent: north of 54°N */
export const NORWAY_BOUNDS: [[number, number], [number, number]] = [
  [-70, 54],
  [40, 80],
];

type Props = {
  center: { latitude: number; longitude: number };
  zoom: number;
  mapStyle?: string;
  attribution?: string;
  /** Injected into style URLs that contain __MAPTILER_KEY__ */
  maptilerKey?: string;
  /** When true (default), fit the map to the North Atlantic monitoring extent on load */
  fitNorway?: boolean;
  children?: React.ReactNode;
};

function injectMaptilerKey(style: any, key: string | undefined): any {
  if (!key) return style;
  const raw = JSON.stringify(style);
  if (!raw.includes(MAPTILER_KEY_PLACEHOLDER)) return style;
  return JSON.parse(raw.split(MAPTILER_KEY_PLACEHOLDER).join(key));
}

async function resolveMapStyle(
  mapStyle: string,
  maptilerKey?: string
): Promise<string | maplibregl.StyleSpecification> {
  // Remote MapTiler hosted style URLs already include ?key=
  if (/^https?:\/\//i.test(mapStyle)) {
    if (maptilerKey && mapStyle.includes(MAPTILER_KEY_PLACEHOLDER)) {
      return mapStyle.split(MAPTILER_KEY_PLACEHOLDER).join(maptilerKey);
    }
    return mapStyle;
  }
  // Local style JSON — fetch and inject MapTiler key when needed
  try {
    const res = await fetch(mapStyle, { cache: 'no-cache' });
    if (!res.ok) return mapStyle;
    const json = await res.json();
    return injectMaptilerKey(json, maptilerKey);
  } catch {
    return mapStyle;
  }
}

export default function MapContainer({
  center,
  zoom,
  mapStyle = DEFAULT_STYLE,
  attribution,
  maptilerKey,
  fitNorway = true,
  children,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let resizeHandler: (() => void) | undefined;
    let ro: ResizeObserver | null = null;

    const wrap = wrapperRef.current;
    const el = containerRef.current;
    if (wrap) {
      el.style.width = `${wrap.clientWidth}px`;
      el.style.height = `${wrap.clientHeight}px`;
    }

    (async () => {
      const style = await resolveMapStyle(mapStyle, maptilerKey);
      if (cancelled || !containerRef.current || mapRef.current) return;

      const m = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [center.longitude, center.latitude],
        zoom,
        attributionControl: !attribution,
        dragRotate: false,
        pitchWithRotate: false,
        // Needed so WebGL content appears in screenshots / some embed browsers
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      });

      m.setRenderWorldCopies(true);
      try {
        m.touchZoomRotate.disableRotation();
      } catch {
        // Ignore if not available
      }

      if (attribution) {
        m.addControl(
          new maplibregl.AttributionControl({ compact: true, customAttribution: attribution })
        );
        // Ensure attribution starts collapsed (MapLibre sometimes expands on init)
        requestAnimationFrame(() => {
          const el = m.getContainer().querySelector('.maplibregl-ctrl-attrib');
          el?.classList.remove('maplibregl-compact-show');
        });
      }

      const applyNorwayView = () => {
        if (!fitNorway) return;
        const wrapEl = wrapperRef.current;
        const canvasEl = containerRef.current;
        if (wrapEl && canvasEl) {
          canvasEl.style.width = `${wrapEl.clientWidth}px`;
          canvasEl.style.height = `${wrapEl.clientHeight}px`;
        }
        m.resize();
        m.fitBounds(NORWAY_BOUNDS, {
          padding: { top: 48, bottom: 96, left: 48, right: 48 },
          duration: 0,
          maxZoom: 3.25,
        });
      };

      let ready = false;
      const onReady = () => {
        if (ready) return;
        try {
          if (!m.getStyle()?.layers?.length) return;
        } catch {
          return;
        }
        // Ignore cancelled here — Strict Mode unmount/remount must still expose a live map.
        if (mapRef.current !== m) return;
        ready = true;
        if (stylePoll != null) window.clearInterval(stylePoll);
        try {
          m.off('styledata', onReady);
        } catch {
          /* ignore */
        }
        applyNorwayView();
        setMap(m);
      };

      let stylePoll: number | undefined;
      // Style object is usually available immediately; also listen for load/styledata.
      m.once('load', onReady);
      m.on('styledata', onReady);
      stylePoll = window.setInterval(onReady, 50);
      window.setTimeout(() => {
        if (stylePoll != null) window.clearInterval(stylePoll);
      }, 15000);
      // Kick immediately — don't wait a tick for the first poll.
      onReady();

      m.on('error', (e) => {
        // eslint-disable-next-line no-console
        console.error('Map error:', e.error ?? e);
      });

      mapRef.current = m;
      if (typeof window !== 'undefined') {
        (window as any).__svalmapMap = m;
      }

      resizeHandler = () => {
        const wrapEl = wrapperRef.current;
        const canvasEl = containerRef.current;
        if (wrapEl && canvasEl) {
          canvasEl.style.width = `${wrapEl.clientWidth}px`;
          canvasEl.style.height = `${wrapEl.clientHeight}px`;
        }
        m.resize();
      };
      window.addEventListener('resize', resizeHandler);

      ro =
        typeof ResizeObserver !== 'undefined' && wrapperRef.current
          ? new ResizeObserver(resizeHandler)
          : null;
      if (wrapperRef.current && ro) ro.observe(wrapperRef.current);

      requestAnimationFrame(resizeHandler);
    })();

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      ro?.disconnect();
      const m = mapRef.current;
      if (m) m.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [center.latitude, center.longitude, zoom, mapStyle, attribution, maptilerKey, fitNorway]);

  return (
    <div
      ref={wrapperRef}
      className="svalmap-map-root"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }}
      data-map-ready={map ? '1' : '0'}
    >
      <div ref={containerRef} id="map" className="svalmap-map-canvas" />
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
