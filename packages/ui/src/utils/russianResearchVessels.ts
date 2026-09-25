/**
 * Curated Russian research / survey vessels to track as their own map category.
 * MMSI is authoritative; IMO is for enrichment / sanctions cross-checks (Yantar has none).
 */
export type RussianResearchVessel = {
  name: string;
  mmsi: string;
  imo: string | null;
};

export const RUSSIAN_RESEARCH_VESSELS: RussianResearchVessel[] = [
  { name: 'Akademik B. Petrov', mmsi: '273454710', imo: '8211150' },
  { name: 'Akademik Fedorov', mmsi: '273412710', imo: '8519837' },
  { name: 'Akademik Ioffe', mmsi: '273413400', imo: '8507731' },
  { name: 'Akademik Lazarev', mmsi: '273450600', imo: '8408985' },
  { name: 'Akademik M. Keldysh', mmsi: '273411400', imo: '7811018' },
  { name: 'Akademik N. Strakhov', mmsi: '273418070', imo: '8211174' },
  { name: 'Akademik Nemchinov', mmsi: '273454600', imo: '8409032' },
  { name: 'Akademik S. Vavilov', mmsi: '273414400', imo: '8507729' },
  { name: 'Akademik Shatskiy', mmsi: '273452600', imo: '8407010' },
  { name: 'Akademik Tryoshnikov', mmsi: '273359440', imo: '9548536' },
  { name: 'Dalnie Zelentsy', mmsi: '273439220', imo: '7740477' },
  { name: 'Fridtjof Nansen', mmsi: '273211700', imo: '8607048' },
  { name: 'Mikhail Somov', mmsi: '273450550', imo: '7518202' },
  { name: 'Professor Molchanov', mmsi: '273458500', imo: '8010348' },
  { name: 'Severniy Polus', mmsi: '273295970', imo: '9884198' },
  { name: 'Yantar', mmsi: '273546520', imo: null },
];

export const RUSSIAN_RESEARCH_MMSI = new Set(
  RUSSIAN_RESEARCH_VESSELS.map((v) => v.mmsi)
);

export const RUSSIAN_RESEARCH_IMO = new Set(
  RUSSIAN_RESEARCH_VESSELS.map((v) => v.imo).filter((x): x is string => !!x)
);

export function isRussianResearchVessel(
  mmsi: unknown,
  imo?: unknown
): boolean {
  const m = String(mmsi ?? '').replace(/\D/g, '').padStart(9, '0').slice(-9);
  if (m && RUSSIAN_RESEARCH_MMSI.has(m)) return true;
  const i = String(imo ?? '').replace(/\D/g, '');
  if (i && RUSSIAN_RESEARCH_IMO.has(i)) return true;
  return false;
}

/** Marker / sidebar accent — fuchsia, distinct from Russia blue & military green */
export const RESEARCH_COLOR = '#d946ef';
