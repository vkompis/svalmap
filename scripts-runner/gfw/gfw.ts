import pRetry from 'p-retry';

const BASE = process.env.GFW_API_BASE || 'https://api.globalfishingwatch.org/v3';
const TOKEN = process.env.GFW_TOKEN;

function headers() {
  return { 
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  };
}

// Generic GET with retry/backoff
export async function gfwGet(pathWithQuery: string) {
  return pRetry(async () => {
    const r = await fetch(`${BASE}${pathWithQuery}`, { 
      headers: headers() 
    });
    if (!r.ok) throw new Error(`GFW ${r.status} ${r.statusText}`);
    return r.json();
  }, { 
    retries: 4
  });
}

// Fetch AIS off events
export async function fetchAisOffEvents({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'ais_off');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/events?${qs.toString()}`);
}

// Fetch encounter events
export async function fetchEncounters({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'encounter');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/events?${qs.toString()}`);
}

// Fetch loitering events
export async function fetchLoiteringEvents({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'loitering');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/events?${qs.toString()}`);
}

// Fetch port visit events
export async function fetchPortVisits({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'port_visit');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/events?${qs.toString()}`);
}

// Fetch SAR detections
export async function fetchSarDetections({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'sar');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/detections?${qs.toString()}`);
}

// Fetch VIIRS detections
export async function fetchViirsDetections({ start, end, geometry, cursor }: {
  start: string;
  end: string;
  geometry?: string;
  cursor?: string;
}) {
  const qs = new URLSearchParams();
  qs.set('types', 'viirs');
  qs.set('start', start);
  qs.set('end', end);
  if (geometry) qs.set('geometry', geometry);
  if (cursor) qs.set('cursor', cursor);
  
  return gfwGet(`/detections?${qs.toString()}`);
}



