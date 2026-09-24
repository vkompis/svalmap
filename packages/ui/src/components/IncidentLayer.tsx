import React, { useEffect } from 'react';
import { useMap } from '../hooks/useMap';
import axios from 'axios';

export default function IncidentLayer() {
  const map = useMap();
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:3001';

  useEffect(() => {
    const id = 'nav-warnings';
    async function load() {
      const { data } = await axios.get(`${apiBase}/api/v1/overlays/navwarnings`);
      const features = (data.data || []).map((w: any) => ({
        type: 'Feature',
        geometry: w.geometry || null,
        properties: { title: w.title || w.name || 'Warning', validFrom: w.validFrom, validTo: w.validTo }
      })).filter((f: any) => !!f.geometry);
      const gj = { type: 'FeatureCollection', features } as any;
      if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: gj });
        map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': '#ef4444', 'line-width': 2, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.1 } });
      } else {
        const src: any = map.getSource(id);
        src.setData(gj);
      }
    }
    if (map.isStyleLoaded()) load(); else map.once('load', load);
    const interval = setInterval(load, 15 * 60 * 1000);
    return () => {
      clearInterval(interval);
      if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
      if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
      if (map.getSource(id)) map.removeSource(id);
    };
  }, [map]);

  return null;
}


