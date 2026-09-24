import React, { useEffect } from 'react';
import { useMap } from '../hooks/useMap';
import axios from 'axios';

type Props = {
  area: 'Svalbard' | 'JanMayen' | 'Norway';
};

export default function RestrictedAreaLayer({ area }: Props) {
  const map = useMap();
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:3001';

  useEffect(() => {
    const id = `aoi-${area}`;
    async function load() {
      const { data } = await axios.get(`${apiBase}/api/v1/areas/aoi`, { params: { name: area } });
      const gj = data.data;
      if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: gj });
        map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.08 } });
        map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': '#0ea5e9', 'line-width': 2 } });
      } else {
        const src: any = map.getSource(id);
        src.setData(gj);
      }
    }
    if (map.isStyleLoaded()) load(); else map.once('load', load);
    return () => {
      if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
      if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
      if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, area]);

  return null;
}


