import dayjs from 'dayjs';
import { fetchAisOffEvents } from '../gfw';
import { mapGfwEvent } from '../transform';
import { upsertGfwEvent, insertIncidentFromEvent } from '../db';

// AOI geometry: provide Svalbard/JanMayen/Norway polygons as GeoJSON string if supported, else use bbox
const AOI_GEOMETRY = process.env.GFW_AOI_GEOMETRY_JSON || '';

export default async function run() {
  const end = dayjs().toISOString();
  const start = dayjs().subtract(7, 'day').toISOString(); // 7-day window; adjust
  
  let cursor: string | undefined;
  
  // Page through results if API provides a cursor token
  for (let page=0; page<50; page++) {
    try {
      const data = await fetchAisOffEvents({ start, end, geometry: AOI_GEOMETRY, cursor });
      const items = data.items || data.data || []; // adapt to API response
      
      for (const ev of items) {
        const e = mapGfwEvent(ev);
        if (!e.lon && !e.lat) continue; // skip invalid geom
        
        await upsertGfwEvent(e);
        // Insert an incident for alerting pipeline
        await insertIncidentFromEvent({ ...e, severity: 3 }); // AIS off => severity 3 (high)
      }
      
      cursor = data.next || data.cursor || undefined;
      if (!cursor) break;
      
    } catch (error) {
      console.error('Error ingesting AIS off events:', error);
      break;
    }
  }
  
  console.log(`AIS off ingestion completed at ${new Date().toISOString()}`);
}



