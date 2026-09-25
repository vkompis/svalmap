/**
 * True when MapLibre has a style object so getLayer / getSource / addLayer are safe.
 * Do NOT require isStyleLoaded() — that stays false while tiles stream and blocks UI for many seconds.
 */
export function mapStyleReady(map: any): boolean {
  if (!map) return false;
  try {
    return Boolean(map.style);
  } catch {
    return false;
  }
}

/** Safe getLayer — returns null if style is not ready or layer missing. */
export function safeGetLayer(map: any, id: string): unknown | null {
  if (!mapStyleReady(map)) return null;
  try {
    return map.getLayer(id) || null;
  } catch {
    return null;
  }
}

/** Safe getSource — returns null if style is not ready or source missing. */
export function safeGetSource(map: any, id: string): unknown | null {
  if (!mapStyleReady(map)) return null;
  try {
    return map.getSource(id) || null;
  } catch {
    return null;
  }
}
