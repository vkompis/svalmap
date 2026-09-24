'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MapContext } from '../hooks/useMap';

const DEFAULT_STYLE = '/styles/svalmap-dark.json';

/** Kingdom of Norway monitoring extent: mainland + Jan Mayen + Svalbard */
export const NORWAY_BOUNDS: [[number, number], [number, number]] = [
  [-10, 57.5],
  [35, 81],
];

type Props = {
  center: { latitude: number; longitude: number };
  zoom: number;
  mapStyle?: string;
  attribution?: string;
  /** When true (default), fit the map to mainland Norway on load */
  fitNorway?: boolean;
  children?: React.ReactNode;
};

export default function MapContainer({
  center,
  zoom,
  mapStyle = DEFAULT_STYLE,
  attribution,
  fitNorway = true,
  children,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const wrap = wrapperRef.current;
    const el = containerRef.current;
    if (wrap) {
      el.style.width = `${wrap.clientWidth}px`;
      el.style.height = `${wrap.clientHeight}px`;
    }

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
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
      m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: attribution }));
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
      });
    };

    m.once('load', () => {
      requestAnimationFrame(applyNorwayView);
    });

    m.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.error('Map error:', e.error ?? e);
    });

    mapRef.current = m;
    setMap(m);
    if (typeof window !== 'undefined') {
      (window as any).__svalmapMap = m;
    }

    const onResize = () => {
      const wrapEl = wrapperRef.current;
      const canvasEl = containerRef.current;
      if (wrapEl && canvasEl) {
        canvasEl.style.width = `${wrapEl.clientWidth}px`;
        canvasEl.style.height = `${wrapEl.clientHeight}px`;
      }
      m.resize();
    };
    window.addEventListener('resize', onResize);

    const ro =
      typeof ResizeObserver !== 'undefined' && wrapperRef.current
        ? new ResizeObserver(onResize)
        : null;
    if (wrapperRef.current && ro) ro.observe(wrapperRef.current);

    requestAnimationFrame(onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      m.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [center.latitude, center.longitude, zoom, mapStyle, attribution, fitNorway]);

  return (
    <div
      ref={wrapperRef}
      className="svalmap-map-root"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }}
    >
      <div ref={containerRef} id="map" className="svalmap-map-canvas" />
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
