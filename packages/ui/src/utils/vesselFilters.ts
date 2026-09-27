/** Client-side visibility filters over live vessel Feature properties. */

import {
  SHIP_CLASS_KEYS,
  type ShipClass,
  resolveShipClass,
} from './shipClass';

export type VesselFilterFlags = {
  /**
   * Country / flag categories — default ON (visible).
   * Apply to civilian traffic only; military / research ignore these.
   */
  norway: boolean;
  eu: boolean;
  china: boolean;
  rest: boolean;
  russia: boolean;
  /**
   * Priority type overlays — default ON.
   * When on, these vessels stay visible regardless of country toggles.
   * When off, that type is hidden even if its flag country is on.
   */
  research: boolean;
  military: boolean;
  /**
   * AIS ship-type buckets (NAIS Fartøytyper-style) — default ON.
   * Applied in addition to country / priority filters.
   */
  fishing: boolean;
  cargo: boolean;
  tanker: boolean;
  passenger: boolean;
  pleasure: boolean;
  hsc: boolean;
  tugWork: boolean;
  militaryAis: boolean;
  other: boolean;
  unknown: boolean;
  /**
   * Optional focus flags — default OFF (no extra restriction).
   * When any are on, vessel must also match at least one.
   */
  sanctioned: boolean;
  shadow: boolean;
  /** When true, only vessels updated within the last 6 hours. */
  recent6h: boolean;
  /** When true, only watchlisted MMSIs. */
  watchlistOnly: boolean;
};

export const DEFAULT_VESSEL_FILTERS: VesselFilterFlags = {
  norway: true,
  eu: true,
  china: true,
  rest: true,
  russia: true,
  research: true,
  military: true,
  fishing: true,
  cargo: true,
  tanker: true,
  passenger: true,
  pleasure: true,
  hsc: true,
  tugWork: true,
  militaryAis: true,
  other: true,
  unknown: true,
  sanctioned: false,
  shadow: false,
  recent6h: false,
  watchlistOnly: false,
};

const COUNTRY_KEYS = ['norway', 'eu', 'china', 'rest', 'russia'] as const;
const TYPE_KEYS = ['research', 'military'] as const;

export type VesselFilterExtras = {
  /** MMSIs on the user watchlist — required when watchlistOnly is on. */
  watchlistMmsis?: ReadonlySet<string> | Iterable<string> | null;
  /** Override "now" for recent6h (tests). */
  nowMs?: number;
};

export function anyFilterActive(f: VesselFilterFlags): boolean {
  for (const k of COUNTRY_KEYS) if (!f[k]) return true;
  for (const k of TYPE_KEYS) if (!f[k]) return true;
  for (const k of SHIP_CLASS_KEYS) if (!f[k]) return true;
  if (f.sanctioned || f.shadow) return true;
  if (f.recent6h || f.watchlistOnly) return true;
  return false;
}

function resolveFlagCountry(v: {
  flagCountry?: string;
  category?: string;
  mmsi?: string;
}): string {
  const fc = String(v.flagCountry || '');
  if (
    fc === 'norway' ||
    fc === 'eu' ||
    fc === 'china' ||
    fc === 'rest' ||
    fc === 'russia'
  ) {
    return fc;
  }
  const cat = String(v.category || '');
  if (
    cat === 'norway' ||
    cat === 'eu' ||
    cat === 'china' ||
    cat === 'rest' ||
    cat === 'russia'
  ) {
    return cat;
  }
  const mid = parseInt(String(v.mmsi || '').slice(0, 3), 10);
  if ([257, 258, 259].includes(mid)) return 'norway';
  if (mid === 273) return 'russia';
  if (mid >= 412 && mid <= 419) return 'china';
  return 'rest';
}

function isResearchVessel(v: {
  category?: string;
  research?: number | boolean;
}): boolean {
  const cat = String(v.category || '');
  return cat === 'research' || v.research === 1 || v.research === true;
}

function isMilitaryVessel(v: {
  category?: string;
  military?: number | boolean;
}): boolean {
  const cat = String(v.category || '');
  return cat === 'military' || v.military === 1 || v.military === true;
}

function countryVisible(flagCountry: string, f: VesselFilterFlags): boolean {
  if (flagCountry === 'norway') return f.norway;
  if (flagCountry === 'eu') return f.eu;
  if (flagCountry === 'china') return f.china;
  if (flagCountry === 'russia') return f.russia;
  return f.rest;
}

function resolveClass(v: {
  shipClass?: string;
  shipType?: string | number | null;
  shipTypeCode?: number | null;
}): ShipClass {
  const sc = String(v.shipClass || '');
  if ((SHIP_CLASS_KEYS as readonly string[]).includes(sc)) return sc as ShipClass;
  return resolveShipClass(v.shipType ?? null, v.shipTypeCode ?? null);
}

function shipClassVisible(shipClass: ShipClass, f: VesselFilterFlags): boolean {
  return Boolean(f[shipClass]);
}

/**
 * Priority types (military / research): controlled only by their own toggle.
 * Civilians: controlled by country flag toggles.
 */
function baseVisible(
  v: {
    category?: string;
    military?: number | boolean;
    research?: number | boolean;
    flagCountry?: string;
    mmsi?: string;
  },
  f: VesselFilterFlags
): boolean {
  if (isResearchVessel(v)) return f.research;
  if (isMilitaryVessel(v)) return f.military;
  return countryVisible(resolveFlagCountry(v), f);
}

function recentEnough(
  v: { timestamp?: string | null },
  f: VesselFilterFlags,
  nowMs: number
): boolean {
  if (!f.recent6h) return true;
  const ts = v.timestamp ? Date.parse(String(v.timestamp)) : NaN;
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= 6 * 60 * 60 * 1000;
}

function onWatchlist(
  v: { mmsi?: string },
  f: VesselFilterFlags,
  extras?: VesselFilterExtras
): boolean {
  if (!f.watchlistOnly) return true;
  const mmsi = String(v.mmsi || '');
  if (!mmsi) return false;
  const raw = extras?.watchlistMmsis;
  if (!raw) return false;
  const set = raw instanceof Set ? raw : new Set([...raw].map(String));
  return set.has(mmsi);
}

function countryVisibleExpr(f: VesselFilterFlags): any {
  const parts: any[] = [];
  if (f.norway) parts.push(['==', ['get', 'flagCountry'], 'norway']);
  if (f.eu) parts.push(['==', ['get', 'flagCountry'], 'eu']);
  if (f.china) parts.push(['==', ['get', 'flagCountry'], 'china']);
  if (f.rest) parts.push(['==', ['get', 'flagCountry'], 'rest']);
  if (f.russia) parts.push(['==', ['get', 'flagCountry'], 'russia']);
  if (parts.length === 0) return ['==', ['get', 'mmsi'], ''];
  if (parts.length === 1) return parts[0];
  return ['any', ...parts];
}

function isResearchExpr(): any {
  return [
    'any',
    ['==', ['get', 'category'], 'research'],
    ['==', ['get', 'research'], 1],
  ];
}

function isMilitaryExpr(): any {
  return [
    'any',
    ['==', ['get', 'category'], 'military'],
    ['==', ['get', 'military'], 1],
  ];
}

function isPriorityExpr(): any {
  return ['any', isResearchExpr(), isMilitaryExpr()];
}

/** MapLibre: (priority ∩ type-on) ∪ (civilian ∩ country-on) */
function baseVisibleExpr(f: VesselFilterFlags): any {
  const priorityParts: any[] = [];
  if (f.research) priorityParts.push(isResearchExpr());
  if (f.military) priorityParts.push(isMilitaryExpr());

  const civilianOk: any = [
    'all',
    ['!', isPriorityExpr()],
    countryVisibleExpr(f),
  ];

  if (priorityParts.length === 0) return civilianOk;
  const priorityOk =
    priorityParts.length === 1
      ? priorityParts[0]
      : (['any', ...priorityParts] as any);
  return ['any', priorityOk, civilianOk];
}

function shipClassExpr(f: VesselFilterFlags): any {
  const parts: any[] = [];
  for (const k of SHIP_CLASS_KEYS) {
    if (f[k]) parts.push(['==', ['get', 'shipClass'], k]);
  }
  if (parts.length === 0) return ['==', ['get', 'mmsi'], ''];
  if (parts.length === 1) return parts[0];
  return ['any', ...parts];
}

function focusExpr(f: VesselFilterFlags): any | null {
  const parts: any[] = [];
  if (f.sanctioned) parts.push(['==', ['get', 'sanctioned'], 1]);
  if (f.shadow) parts.push(['==', ['get', 'shadowfleet'], 1]);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return ['any', ...parts];
}

/** MapLibre filter expression, or null when everything is visible (defaults). */
export function vesselFilterExpression(f: VesselFilterFlags): any | null {
  if (!anyFilterActive(f)) return null;
  const parts: any[] = [baseVisibleExpr(f), shipClassExpr(f)];
  const focus = focusExpr(f);
  if (focus) parts.push(focus);
  // recent6h / watchlistOnly need runtime values — handled in vesselPassesFilter only
  return parts.length === 1 ? parts[0] : ['all', ...parts];
}

export function vesselPassesFilter(
  v: {
    sanctioned?: number | boolean;
    shadowfleet?: number | boolean;
    military?: number | boolean;
    research?: number | boolean;
    category?: string;
    flagCountry?: string;
    mmsi?: string;
    shipClass?: string;
    shipType?: string | number | null;
    shipTypeCode?: number | null;
    timestamp?: string | null;
  },
  f: VesselFilterFlags,
  extras?: VesselFilterExtras
): boolean {
  if (!baseVisible(v, f)) return false;
  if (!shipClassVisible(resolveClass(v), f)) return false;
  if (!recentEnough(v, f, extras?.nowMs ?? Date.now())) return false;
  if (!onWatchlist(v, f, extras)) return false;

  if (!f.sanctioned && !f.shadow) return true;
  if (f.sanctioned && (v.sanctioned === 1 || v.sanctioned === true)) return true;
  if (f.shadow && (v.shadowfleet === 1 || v.shadowfleet === true)) return true;
  return false;
}

/** Merge stored/URL filter blobs onto defaults; ignore legacy exclusive-only shape. */
export function mergeVesselFilters(
  raw: Partial<VesselFilterFlags> | Record<string, unknown> | null | undefined
): VesselFilterFlags {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VESSEL_FILTERS };
  if (typeof (raw as VesselFilterFlags).norway === 'boolean') {
    return { ...DEFAULT_VESSEL_FILTERS, ...(raw as Partial<VesselFilterFlags>) };
  }
  return {
    ...DEFAULT_VESSEL_FILTERS,
    sanctioned: Boolean(raw.sanctioned),
    shadow: Boolean(raw.shadow),
  };
}

/** Compact URL tokens: `-norway` hides a category; `sanctioned`/`shadow`/`age6`/`watchlist` enable extras. */
export function vesselFiltersToUrlTokens(f: VesselFilterFlags): string[] {
  const out: string[] = [];
  for (const k of COUNTRY_KEYS) if (!f[k]) out.push(`-${k}`);
  for (const k of TYPE_KEYS) if (!f[k]) out.push(`-${k}`);
  for (const k of SHIP_CLASS_KEYS) if (!f[k]) out.push(`-${k}`);
  if (f.sanctioned) out.push('sanctioned');
  if (f.shadow) out.push('shadow');
  if (f.recent6h) out.push('age6');
  if (f.watchlistOnly) out.push('watchlist');
  return out;
}

export function vesselFiltersFromUrlTokens(tokens: string[]): VesselFilterFlags {
  const f = { ...DEFAULT_VESSEL_FILTERS };
  for (const raw of tokens) {
    const t = raw.trim().toLowerCase();
    if (t === 'sanctioned') f.sanctioned = true;
    else if (t === 'shadow' || t === 'shadowfleet') f.shadow = true;
    else if (t === 'age6' || t === 'recent6h') f.recent6h = true;
    else if (t === 'watchlist' || t === 'favorites') f.watchlistOnly = true;
    else if (t.startsWith('-')) {
      const key = t.slice(1);
      if (key === 'russian') f.russia = false;
      else if (key === 'tug_work' || key === 'tug-work') f.tugWork = false;
      else if (key === 'military_ais' || key === 'military-ais') f.militaryAis = false;
      else if (key in f) (f as any)[key] = false;
    }
  }
  return f;
}
