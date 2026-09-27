/** Map AIS shipType / shipTypeCode → coarse filter buckets (NAIS-style). */

export const SHIP_CLASS_KEYS = [
  'fishing',
  'cargo',
  'tanker',
  'passenger',
  'pleasure',
  'hsc',
  'tugWork',
  'militaryAis',
  'other',
  'unknown',
] as const;

export type ShipClass = (typeof SHIP_CLASS_KEYS)[number];

export const SHIP_CLASS_LABELS: Record<ShipClass, string> = {
  fishing: 'Fishing',
  cargo: 'Cargo',
  tanker: 'Tanker',
  passenger: 'Passenger',
  pleasure: 'Pleasure / sailing',
  hsc: 'High-speed craft',
  tugWork: 'Tug / pilot / work',
  militaryAis: 'Military / law',
  other: 'Other',
  unknown: 'Unknown type',
};

function fromCode(n: number): ShipClass | null {
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n === 30) return 'fishing';
  if (n === 36 || n === 37) return 'pleasure';
  if (n >= 40 && n <= 49) return 'hsc';
  if (n === 35 || n === 55 || n === 59) return 'militaryAis';
  if (
    n === 31 ||
    n === 32 ||
    n === 33 ||
    n === 34 ||
    (n >= 50 && n <= 54) ||
    n === 56 ||
    n === 57 ||
    n === 58
  ) {
    return 'tugWork';
  }
  if (n >= 60 && n <= 69) return 'passenger';
  if (n >= 70 && n <= 79) return 'cargo';
  if (n >= 80 && n <= 89) return 'tanker';
  if (n >= 90 && n <= 99) return 'other';
  if (n >= 20 && n <= 29) return 'other';
  if (n >= 1 && n <= 19) return 'other';
  return null;
}

function fromLabel(raw: string): ShipClass {
  const s = raw.toLowerCase().trim();
  if (!s || s === 'not available' || s === 'n/a' || s === 'null' || s === 'unknown') {
    return 'unknown';
  }
  if (s.includes('fish')) return 'fishing';
  if (s.includes('tanker')) return 'tanker';
  if (s.includes('cargo')) return 'cargo';
  if (s.includes('passenger')) return 'passenger';
  if (s.includes('pleasure') || s.includes('sailing')) return 'pleasure';
  if (s.includes('high speed') || s.startsWith('hsc')) return 'hsc';
  if (
    s.includes('military') ||
    s.includes('law enforcement') ||
    s.includes('noncombatant')
  ) {
    return 'militaryAis';
  }
  if (
    s.includes('tug') ||
    s.includes('tow') ||
    s.includes('pilot') ||
    s.includes('port tender') ||
    s.includes('dredg') ||
    s.includes('diving') ||
    s.includes('anti-pollution') ||
    s.includes('search and rescue') ||
    s.includes('medical') ||
    s.includes('local vessel') ||
    s.includes('spare')
  ) {
    return 'tugWork';
  }
  if (s.includes('other') || s.includes('wig') || s.includes('reserved')) return 'other';
  return 'other';
}

/** Resolve coarse ship class from AIS type string and/or numeric code. */
export function resolveShipClass(
  shipType?: string | number | null,
  shipTypeCode?: number | null
): ShipClass {
  if (shipTypeCode != null) {
    const fromN = fromCode(Number(shipTypeCode));
    if (fromN) return fromN;
  }
  if (typeof shipType === 'number') {
    const fromN = fromCode(shipType);
    if (fromN) return fromN;
  }
  if (shipType == null || shipType === '') return 'unknown';
  const asNum = Number(shipType);
  if (Number.isFinite(asNum) && String(shipType).trim() !== '' && !/[a-z]/i.test(String(shipType))) {
    const fromN = fromCode(asNum);
    if (fromN) return fromN;
  }
  return fromLabel(String(shipType));
}
