/** Client-side filters over live vessel Feature properties. */

export type VesselFilterFlags = {
  sanctioned: boolean;
  shadow: boolean;
  research: boolean;
  military: boolean;
  russian: boolean;
  /** When true, only vessels matching at least one enabled flag are shown.
   *  When no flags are enabled, all vessels pass. */
  exclusive: boolean;
};

export const DEFAULT_VESSEL_FILTERS: VesselFilterFlags = {
  sanctioned: false,
  shadow: false,
  research: false,
  military: false,
  russian: false,
  exclusive: false,
};

export function anyFilterActive(f: VesselFilterFlags): boolean {
  return f.sanctioned || f.shadow || f.research || f.military || f.russian;
}

/** MapLibre filter expression, or null for no filter. */
export function vesselFilterExpression(f: VesselFilterFlags): any | null {
  if (!anyFilterActive(f)) return null;
  const clauses: any[] = [];
  if (f.sanctioned) clauses.push(['==', ['get', 'sanctioned'], 1]);
  if (f.shadow) clauses.push(['==', ['get', 'shadowfleet'], 1]);
  if (f.research) clauses.push(['==', ['get', 'category'], 'research']);
  if (f.military) clauses.push(['==', ['get', 'military'], 1]);
  if (f.russian) clauses.push(['==', ['get', 'category'], 'russia']);
  if (clauses.length === 1) return clauses[0];
  return ['any', ...clauses];
}

export function vesselPassesFilter(
  v: {
    sanctioned?: number | boolean;
    shadowfleet?: number | boolean;
    military?: number | boolean;
    category?: string;
  },
  f: VesselFilterFlags
): boolean {
  if (!anyFilterActive(f)) return true;
  if (f.sanctioned && (v.sanctioned === 1 || v.sanctioned === true)) return true;
  if (f.shadow && (v.shadowfleet === 1 || v.shadowfleet === true)) return true;
  if (f.research && v.category === 'research') return true;
  if (f.military && (v.military === 1 || v.military === true)) return true;
  if (f.russian && v.category === 'russia') return true;
  return false;
}
