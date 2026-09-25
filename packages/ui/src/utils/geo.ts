/** Lightweight geo helpers (no Turf dependency). */

export type LonLat = [number, number];

function ringContains(ring: LonLat[], lon: number, lat: number): boolean {
  // Ray casting; ring is closed or open
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon including holes (even-odd via outer true, hole flips). */
export function pointInPolygonCoords(
  lon: number,
  lat: number,
  coordinates: LonLat[][]
): boolean {
  if (!coordinates?.length) return false;
  if (!ringContains(coordinates[0], lon, lat)) return false;
  for (let h = 1; h < coordinates.length; h++) {
    if (ringContains(coordinates[h], lon, lat)) return false;
  }
  return true;
}

export function pointInGeometry(
  lon: number,
  lat: number,
  geometry: { type: string; coordinates: any } | null | undefined
): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(lon, lat, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (pointInPolygonCoords(lon, lat, poly)) return true;
    }
  }
  return false;
}

export function pointInGeoJSON(
  lon: number,
  lat: number,
  gj: any
): boolean {
  if (!gj) return false;
  if (gj.type === 'FeatureCollection') {
    for (const f of gj.features || []) {
      if (pointInGeometry(lon, lat, f.geometry)) return true;
    }
    return false;
  }
  if (gj.type === 'Feature') return pointInGeometry(lon, lat, gj.geometry);
  return pointInGeometry(lon, lat, gj);
}
