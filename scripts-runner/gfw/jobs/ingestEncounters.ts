import dayjs from 'dayjs';
import { fetchEncounters } from '../gfw';
import { mapGfwEvent } from '../transform';
import { upsertGfwEvent, insertIncidentFromEvent } from '../db';

const AOI_GEOMETRY = process.env.GFW_AOI_GEOMETRY_JSON || '';

export default async function run() {
  const end = dayjs().toISOString();
  const start = dayjs().subtract(7, 'day').toISOString();
  
  let cursor: string | undefined;
  
  for (let page=0; page<50; page++) {
    try {
      const data = await fetchEncounters({ start, end, geometry: AOI_GEOMETRY, cursor });
      const items = data.items || data.data || [];
      
      for (const ev of items) {
        const e = mapGfwEvent(ev);
        if (!e.lon && !e.lat) continue;
        
        await upsertGfwEvent(e);
        await insertIncidentFromEvent({ ...e, severity: 2 });
        
        // If the API provides both vessel positions, optionally write a LineString to gfw_encounter_links
        // (Cursor: implement when field names are confirmed)
      }
      
      cursor = data.next || data.cursor || undefined;
      if (!cursor) break;
      
    } catch (error) {
      console.error('Error ingesting encounters:', error);
      break;
    }
  }
  
  console.log(`Encounters ingestion completed at ${new Date().toISOString()}`);
}



