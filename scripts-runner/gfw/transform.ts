export function toPointCentroid(ev: any) {
  // Try ev.geometry centroid; fallback to average of involved positions if provided
  const g = ev.geometry;
  if (g?.type === 'Point' && Array.isArray(g.coordinates)) {
    return { lon: g.coordinates[0], lat: g.coordinates[1] };
  }
  if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length) {
    const mid = g.coordinates[Math.floor(g.coordinates.length/2)];
    return { lon: mid[0], lat: mid[1] };
  }
  // fallback: 0,0 (should not happen), caller should guard
  return { lon: 0, lat: 0 };
}

export function mapGfwEvent(ev: any) {
  const { lon, lat } = toPointCentroid(ev);
  return {
    id: ev.id || ev.eventId || `${ev.type}-${ev.timestamp}`,
    type: (ev.type || '').toLowerCase(),
    started_at: ev.start || ev.started_at || null,
    ended_at: ev.end || ev.ended_at || null,
    ts: ev.timestamp || ev.end || ev.start || null,
    lon, lat,
    vessels: ev.vessels || ev.participants || [],
    payload_json: ev,
    source_version: ev.version || null
  };
}



