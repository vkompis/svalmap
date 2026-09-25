export type AlertAreaId = 'eez-norway' | 'eez-janmayen' | 'eez-svalbard' | 'custom';

export type AlertPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type AreaAlertRule = {
  id: string;
  /** Empty array = watch any vessel entering the area */
  mmsis: string[];
  vesselNames: Record<string, string>;
  areaId: AlertAreaId;
  areaLabel: string;
  /** Custom AOI polygon (required when areaId === 'custom') */
  polygon: AlertPolygon | null;
  /** Minutes inside before firing (0 = on entry) */
  dwellMinutes: number;
  watchHours: number;
  email: string | null;
  createdAt: string;
  /** mmsi -> ISO enteredAt while currently inside */
  insideSince: Record<string, string>;
  /** mmsis already notified this watch (avoid repeat spam) */
  notified: string[];
  status: 'watching' | 'triggered' | 'expired';
  triggeredAt: string | null;
  message: string | null;
  lastEmailError: string | null;
};

export type AlertAreaDef = {
  id: Exclude<AlertAreaId, 'custom'>;
  label: string;
  file: string;
};

export const ALERT_AREAS: AlertAreaDef[] = [
  { id: 'eez-norway', label: 'Norway EEZ', file: 'norway-eez.geojson' },
  { id: 'eez-janmayen', label: 'Jan Mayen EEZ', file: 'janmayen-eez.geojson' },
  { id: 'eez-svalbard', label: 'Svalbard FPZ', file: 'svalbard-fpz.geojson' },
];

export const ALERTS_STORAGE_KEY = 'svalmap.areaAlerts.v2';

function normalizeMmsi(raw: string): string {
  return String(raw).replace(/\D/g, '').padStart(9, '0').slice(-9);
}

export function parseMmsiList(raw: string): string[] {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const m = normalizeMmsi(p);
    if (m.length === 9 && m !== '000000000' && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

export function loadAlertRules(): AreaAlertRule[] {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) {
      // migrate v1
      const v1 = localStorage.getItem('svalmap.areaAlerts.v1');
      if (!v1) return [];
      const old = JSON.parse(v1);
      if (!Array.isArray(old)) return [];
      return old.map((r: any) => migrateV1(r));
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeRule) : [];
  } catch {
    return [];
  }
}

function migrateV1(r: any): AreaAlertRule {
  const mmsi = normalizeMmsi(r.mmsi || '');
  return normalizeRule({
    id: r.id || `alert-${Date.now()}`,
    mmsis: mmsi ? [mmsi] : [],
    vesselNames: mmsi ? { [mmsi]: r.vesselName || `MMSI ${mmsi}` } : {},
    areaId: r.areaId || 'eez-svalbard',
    areaLabel: r.areaLabel || areaLabel(r.areaId || 'eez-svalbard'),
    polygon: null,
    dwellMinutes: r.dwellMinutes ?? 60,
    watchHours: r.watchHours ?? 24,
    email: null,
    createdAt: r.createdAt || new Date().toISOString(),
    insideSince: r.enteredAt && mmsi ? { [mmsi]: r.enteredAt } : {},
    notified: [],
    status: r.status || 'watching',
    triggeredAt: r.triggeredAt || null,
    message: r.message || null,
    lastEmailError: null,
  });
}

function normalizeRule(r: any): AreaAlertRule {
  return {
    id: String(r.id),
    mmsis: Array.isArray(r.mmsis) ? r.mmsis.map(normalizeMmsi) : [],
    vesselNames: r.vesselNames && typeof r.vesselNames === 'object' ? r.vesselNames : {},
    areaId: r.areaId || 'eez-svalbard',
    areaLabel: r.areaLabel || areaLabel(r.areaId || 'eez-svalbard'),
    polygon: r.polygon || null,
    dwellMinutes: Math.max(0, Number(r.dwellMinutes) || 0),
    watchHours: Math.max(1, Number(r.watchHours) || 24),
    email: r.email ? String(r.email).trim() : null,
    createdAt: r.createdAt || new Date().toISOString(),
    insideSince: r.insideSince && typeof r.insideSince === 'object' ? r.insideSince : {},
    notified: Array.isArray(r.notified) ? r.notified : [],
    status: r.status || 'watching',
    triggeredAt: r.triggeredAt || null,
    message: r.message || null,
    lastEmailError: r.lastEmailError || null,
  };
}

export function saveAlertRules(rules: AreaAlertRule[]) {
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* ignore */
  }
}

export function createAlertRule(input: {
  mmsis: string[];
  vesselNames?: Record<string, string>;
  areaId: AlertAreaId;
  areaLabel?: string;
  polygon?: AlertPolygon | null;
  dwellMinutes: number;
  watchHours: number;
  email?: string | null;
}): AreaAlertRule {
  const mmsis = input.mmsis.map(normalizeMmsi).filter(Boolean);
  const label =
    input.areaLabel ||
    (input.areaId === 'custom' ? 'Custom AOI' : areaLabel(input.areaId));
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mmsis,
    vesselNames: input.vesselNames || {},
    areaId: input.areaId,
    areaLabel: label,
    polygon: input.areaId === 'custom' ? input.polygon || null : null,
    dwellMinutes: Math.max(0, Math.round(input.dwellMinutes)),
    watchHours: Math.max(1, Math.round(input.watchHours)),
    email: input.email?.trim() || null,
    createdAt: new Date().toISOString(),
    insideSince: {},
    notified: [],
    status: 'watching',
    triggeredAt: null,
    message: null,
    lastEmailError: null,
  };
}

export function areaLabel(id: AlertAreaId): string {
  if (id === 'custom') return 'Custom AOI';
  return ALERT_AREAS.find((a) => a.id === id)?.label || id;
}

export function ruleWatchSummary(rule: AreaAlertRule): string {
  const ships =
    rule.mmsis.length === 0
      ? 'any ship'
      : rule.mmsis.length === 1
        ? rule.vesselNames[rule.mmsis[0]] || rule.mmsis[0]
        : `${rule.mmsis.length} ships`;
  const dwell =
    rule.dwellMinutes <= 0 ? 'on entry' : `≥${rule.dwellMinutes} min`;
  return `${ships} · ${rule.areaLabel} · ${dwell} · ${rule.watchHours}h`;
}
