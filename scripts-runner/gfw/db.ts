import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function upsertGfwEvent(e: any) {
  // e must contain: id, type, started_at, ended_at, ts, lon, lat, vessels, payload_json, source_version
  const q = `
    INSERT INTO gfw_events (id, type, started_at, ended_at, ts, geom, vessels, payload_json, source_version, updated_at) 
    VALUES ($1,$2,$3,$4,$5, ST_SetSRID(ST_MakePoint($6,$7),4326)::geography, $8, $9, $10, now()) 
    ON CONFLICT (id) DO UPDATE SET 
      type=EXCLUDED.type, 
      started_at=EXCLUDED.started_at, 
      ended_at=EXCLUDED.ended_at, 
      ts=EXCLUDED.ts, 
      geom=EXCLUDED.geom, 
      vessels=EXCLUDED.vessels, 
      payload_json=EXCLUDED.payload_json, 
      source_version=EXCLUDED.source_version, 
      updated_at=now() 
    RETURNING id
  `;
  
  const vals = [
    e.id, e.type, e.started_at, e.ended_at, e.ts, 
    e.lon, e.lat, 
    JSON.stringify(e.vessels||[]), 
    JSON.stringify(e.payload_json||{}), 
    e.source_version||null
  ];
  
  const { rows } = await pool.query(q, vals);
  return rows[0]?.id;
}

export async function insertIncidentFromEvent(e: any) {
  const q = `
    INSERT INTO incidents (type, ts, geom, severity, source, payload_json) 
    VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, 'gfw', $6) 
    RETURNING id
  `;
  
  const vals = [
    e.type, 
    e.ts || e.started_at, 
    e.lon, e.lat, 
    e.severity || 1, 
    JSON.stringify(e.payload_json||{})
  ];
  
  const { rows } = await pool.query(q, vals);
  return rows[0]?.id;
}



