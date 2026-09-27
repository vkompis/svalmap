/** Speed-based distance rings (NAIS / scripts-runner style). */

const METERS_PER_NM = 1852;

/** Minutes → radius at constant SOG. */
export const PROJECTION_MINUTES = [10, 30, 60, 180, 360, 540] as const;

export function computeCircle(
  lon: number,
  lat: number,
  radiusMeters: number,
  steps = 240
): [number, number][] {
  const pts: [number, number][] = [];
  const n = steps;
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(0.05, Math.cos(latRad));
  for (let i = 0; i <= n; i++) {
    const ang = (i / n) * 2 * Math.PI;
    const dlon = (radiusMeters * Math.cos(ang)) / (111320 * cosLat);
    const dlat = (radiusMeters * Math.sin(ang)) / 110540;
    pts.push([lon + dlon, lat + dlat]);
  }
  return pts;
}

function timeLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} h`;
  }
  return `${minutes} min`;
}

export function formatProjectionLabel(minutes: number, speedKn: number): string {
  const nm = speedKn * (minutes / 60);
  const nmRounded = Math.round(nm * 10) / 10;
  return `Distance after ${timeLabel(minutes)}: ${nmRounded} nm`;
}

export type ProjectionRingFeature = {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: {
    subtype: 'ring';
    minutes: number;
    label: string;
    shortLabel: string;
    nm: number;
  };
};

/**
 * Concentric rings: distance = SOG × time.
 * Returns empty when speed is effectively zero.
 */
export function buildProjectionRingFeatures(
  lon: number,
  lat: number,
  sogKn: number | null | undefined,
  minutesList: readonly number[] = PROJECTION_MINUTES
): ProjectionRingFeature[] {
  const speedKn = Math.max(0, Number(sogKn) || 0);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
  if (speedKn < 0.15) return [];

  const feats: ProjectionRingFeature[] = [];
  for (const min of minutesList) {
    const nm = speedKn * (min / 60);
    const radiusMeters = nm * METERS_PER_NM;
    if (radiusMeters < 40) continue;
    feats.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: computeCircle(lon, lat, radiusMeters, 240),
      },
      properties: {
        subtype: 'ring',
        minutes: min,
        label: formatProjectionLabel(min, speedKn),
        shortLabel: `After ${timeLabel(min)}`,
        nm: Math.round(nm * 10) / 10,
      },
    });
  }
  return feats;
}
