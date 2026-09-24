/** Vessel category / color helpers — source of truth matching scripts-runner legend */

export type VesselCategory = 'norway' | 'russia' | 'eu' | 'china' | 'military' | 'rest';

export const HEADER_COLORS: Record<VesselCategory, string> = {
  norway: '#ff4040',
  russia: '#7dacff',
  eu: '#2b2bcc',
  china: '#f2c403',
  military: '#2b6206', // matches Mapmarkers/Militarycircle.svg
  rest: '#f7f7f7',
};

export function headerTextColor(cat: VesselCategory): string {
  return cat === 'rest' ? '#111' : '#fff';
}

const MID_TO_ISO: Record<number, string> = {
  265: 'se', 266: 'se', 219: 'dk', 220: 'dk', 230: 'fi', 211: 'de', 218: 'de',
  244: 'nl', 245: 'nl', 246: 'nl', 226: 'fr', 227: 'fr', 228: 'fr', 224: 'es', 225: 'es',
  263: 'pt', 247: 'it', 237: 'gr', 239: 'gr', 240: 'gr', 241: 'gr', 250: 'ie', 261: 'pl',
  276: 'ee', 275: 'lv', 277: 'lt', 201: 'at', 207: 'bg', 270: 'cz', 271: 'tr',
  232: 'gb', 233: 'gb', 234: 'gb', 235: 'gb', 231: 'fo', 236: 'gi',
  257: 'no', 258: 'no', 259: 'no', 273: 'ru',
  308: 'bs', 309: 'bs', 310: 'bs', 311: 'bs',
  351: 'pa', 352: 'pa', 353: 'pa', 354: 'pa', 355: 'pa',
  412: 'cn', 413: 'cn', 414: 'cn', 415: 'cn', 416: 'tw',
};

const MID_TO_NAME: Record<number, string> = {
  257: 'Norway', 258: 'Norway', 259: 'Norway', 273: 'Russian Federation',
  265: 'Sweden', 266: 'Sweden', 219: 'Denmark', 220: 'Denmark', 230: 'Finland',
  211: 'Germany', 218: 'Germany', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands',
  226: 'France', 227: 'France', 228: 'France', 412: 'China', 413: 'China',
};

const EU_ISO = new Set([
  'se', 'dk', 'fi', 'de', 'nl', 'fr', 'es', 'pt', 'it', 'gr', 'ie', 'pl', 'ee', 'lv', 'lt',
  'be', 'bg', 'ro', 'cz', 'sk', 'si', 'hr', 'cy', 'mt', 'hu', 'lu', 'at',
]);

export function isMilitaryShipType(shipType: unknown): boolean {
  return (
    shipType === 35 ||
    shipType === 55 ||
    shipType === 'Military ops' ||
    shipType === 'Law enforcement'
  );
}

export function mmsiCategory(mmsi: unknown, shipType?: unknown): VesselCategory {
  if (isMilitaryShipType(shipType)) return 'military';
  const s = String(mmsi || '');
  const mid = parseInt(s.slice(0, 3), 10);
  if ([257, 258, 259].includes(mid)) return 'norway';
  if (mid === 273) return 'russia';
  const iso = MID_TO_ISO[mid];
  if (iso && EU_ISO.has(iso)) return 'eu';
  if (mid >= 412 && mid <= 419) return 'china';
  return 'rest';
}

export function countryInfoFromMmsi(mmsi: unknown): { iso: string; name: string } {
  const mid = parseInt(String(mmsi || '').slice(0, 3), 10);
  const iso = MID_TO_ISO[mid] || 'xx';
  const name = MID_TO_NAME[mid] || (iso === 'xx' ? 'Unknown' : iso.toUpperCase());
  return { iso, name };
}

export function navStatusLabel(code: unknown): string {
  const n = typeof code === 'number' ? code : parseInt(String(code ?? ''), 10);
  const map: Record<number, string> = {
    0: 'Under way using engine',
    1: 'At anchor',
    2: 'Not under command',
    3: 'Restricted manoeuvrability',
    4: 'Constrained by draught',
    5: 'Moored',
    6: 'Aground',
    7: 'Engaged in fishing',
    8: 'Under way sailing',
    14: 'AIS-SART is active',
    15: 'Not defined',
  };
  if (Number.isNaN(n)) return code == null || code === '' ? 'Not available' : String(code);
  return map[n] ?? String(code);
}
