/**
 * EU designated vessel list updater.
 * Primary source: Danish Maritime Authority (DMA) EU vessel designations page.
 * Verification:
 *  - FleetLeaks changelog (informational)
 *  - OpenSanctions maritime bulk export (https://www.opensanctions.org/search/?scope=default&schema=Vessel)
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export const DMA_PAGE_URL =
  'https://www.dma.dk/growth-and-framework-conditions/maritime-sanctions/general-information/eu-vessel-designations';
export const FLEETLEAKS_CHANGELOG_URL = 'https://fleetleaks.com/changelog/';
export const OPENSANCTIONS_SEARCH_URL =
  'https://www.opensanctions.org/search/?scope=default&schema=Vessel';
export const OPENSANCTIONS_MARITIME_CSV_URL =
  'https://data.opensanctions.org/datasets/latest/maritime/maritime.csv';

const DATA_DIR = '/Users/vegardhalkjelsvik/Dev/svalmap/data/source';
export const EU_DESIGNATED_CSV = path.join(DATA_DIR, 'eu-designated-vessels.csv');
export const EU_DESIGNATED_META = path.join(DATA_DIR, 'eu-designated-vessels.meta.json');
export const OPENSANCTIONS_VESSELS_CSV = path.join(DATA_DIR, 'opensanctions-vessels.csv');

export type EuVesselRow = {
  imo: string;
  name: string;
  date_of_application: string;
  eu_oj_link: string;
  source: string;
};

export type OpenSanctionsVesselRow = {
  imo: string;
  mmsi: string;
  name: string;
  risk: string;
  flag: string;
  url: string;
  datasets: string;
};

export type SanctionsUpdateResult = {
  ok: boolean;
  imoCount: number;
  added: string[];
  dmaFileUrl?: string;
  fleetleaksImosMentioned: number;
  fleetleaksNotInList: string[];
  openSanctions?: {
    sanctionedImos: number;
    sanctionedMmsis: number;
    shadowImos: number;
    euOverlap: number;
    euMissingFromOpenSanctions: string[];
    openSanctionsNotInEuSample: string[];
  };
  error?: string;
  updatedAt: string;
};

function parseImo(raw: unknown): string | null {
  const m = String(raw ?? '').match(/\b(\d{7})\b/);
  return m ? m[1] : null;
}

export function readEuDesignatedCsv(filePath = EU_DESIGNATED_CSV): Map<string, EuVesselRow> {
  const map = new Map<string, EuVesselRow>();
  if (!fs.existsSync(filePath)) return map;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return map;
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const imoIdx = headers.findIndex((h) => h.includes('imo'));
  const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('vessel'));
  const dateIdx = headers.findIndex((h) => h.includes('date'));
  const linkIdx = headers.findIndex((h) => h.includes('link') || h.includes('oj'));
  const sourceIdx = headers.findIndex((h) => h === 'source');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const imo = parseImo(imoIdx >= 0 ? cols[imoIdx] : lines[i]);
    if (!imo) continue;
    map.set(imo, {
      imo,
      name: nameIdx >= 0 ? (cols[nameIdx] || '').replace(/^"|"$/g, '').trim() : '',
      date_of_application: dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '',
      eu_oj_link: linkIdx >= 0 ? (cols[linkIdx] || '').trim() : '',
      source: sourceIdx >= 0 ? (cols[sourceIdx] || '').trim() : 'local',
    });
  }
  return map;
}

function writeEuDesignatedCsv(rows: EuVesselRow[], filePath = EU_DESIGNATED_CSV): void {
  const header = 'imo,name,date_of_application,eu_oj_link,source\n';
  const esc = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = rows
    .map((r) =>
      [r.imo, esc(r.name), esc(r.date_of_application), esc(r.eu_oj_link), esc(r.source)].join(',')
    )
    .join('\n');
  fs.writeFileSync(filePath, header + body + '\n', 'utf8');
}

function writeMeta(partial: Record<string, unknown>): void {
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(fs.readFileSync(EU_DESIGNATED_META, 'utf8'));
  } catch {
    /* empty */
  }
  fs.writeFileSync(
    EU_DESIGNATED_META,
    JSON.stringify(
      {
        ...prev,
        ...partial,
        dma_page: DMA_PAGE_URL,
        verify_page: FLEETLEAKS_CHANGELOG_URL,
        opensanctions_search: OPENSANCTIONS_SEARCH_URL,
        opensanctions_bulk: OPENSANCTIONS_MARITIME_CSV_URL,
      },
      null,
      2
    ),
    'utf8'
  );
}

/** Find newest DMA list download URL from the designations page HTML. */
export function findDmaListUrl(html: string): string | null {
  const matches = [
    ...html.matchAll(/href="(\/Media\/[^"]+\.(?:csv|xlsx))"/gi),
    ...html.matchAll(/href="(https:\/\/www\.dma\.dk\/Media\/[^"]+\.(?:csv|xlsx))"/gi),
  ];
  if (!matches.length) return null;
  // Prefer CSV, then latest path segment
  const urls = matches.map((m) =>
    m[1].startsWith('http') ? m[1] : `https://www.dma.dk${m[1]}`
  );
  const csv = urls.filter((u) => /\.csv$/i.test(u));
  const pick = (csv.length ? csv : urls).sort().at(-1);
  return pick || null;
}

function parseDmaCsv(text: string): EuVesselRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const imoIdx = headers.findIndex((h) => h.includes('imo'));
  const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('vessel'));
  const dateIdx = headers.findIndex((h) => h.includes('date'));
  const rows: EuVesselRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const imo = parseImo(imoIdx >= 0 ? cols[imoIdx] : lines[i]);
    if (!imo) continue;
    rows.push({
      imo,
      name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '',
      date_of_application: dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '',
      eu_oj_link: '',
      source: 'dma-weekly',
    });
  }
  return rows;
}

function isLikelyImo(imo: string): boolean {
  if (!/^\d{7}$/.test(imo)) return false;
  // ISO 9876 check digit: sum(d[i]*(7-i)) for i=0..5, mod 10 == d[6]
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(imo[i]) * (7 - i);
  return sum % 10 === Number(imo[6]);
}

async function extractFleetleaksImos(): Promise<string[]> {
  try {
    const r = await axios.get(FLEETLEAKS_CHANGELOG_URL, {
      timeout: 30000,
      headers: { 'User-Agent': 'SvalMap-sanctions-updater/1.0' },
      responseType: 'text',
    });
    const text = String(r.data || '');
    const found = new Set<string>();
    for (const m of text.matchAll(/IMO[:\s#]*(\d{7})/gi)) {
      if (isLikelyImo(m[1])) found.add(m[1]);
    }
    for (const m of text.matchAll(/\b(\d{7})\b/g)) {
      if (isLikelyImo(m[1])) found.add(m[1]);
    }
    return [...found];
  } catch (e: any) {
    console.warn('[sanctions] fleetleaks fetch failed', e?.message || e);
    return [];
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Download OpenSanctions maritime.csv and write sanctioned/shadow vessel subset locally. */
export async function updateOpenSanctionsVessels(euImos: Set<string>): Promise<{
  rows: OpenSanctionsVesselRow[];
  sanctionedImos: Set<string>;
  sanctionedMmsis: Set<string>;
  shadowImos: Set<string>;
  euOverlap: number;
  euMissingFromOpenSanctions: string[];
  openSanctionsNotInEuSample: string[];
}> {
  const r = await axios.get(OPENSANCTIONS_MARITIME_CSV_URL, {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'SvalMap-sanctions-updater/1.0' },
    maxContentLength: 50 * 1024 * 1024,
  });
  const text = String(r.data || '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('OpenSanctions maritime.csv empty');

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const iType = idx('type');
  const iCaption = idx('caption');
  const iImo = idx('imo');
  const iRisk = idx('risk');
  const iFlag = idx('flag');
  const iMmsi = idx('mmsi');
  const iUrl = idx('url');
  const iDatasets = idx('datasets');

  const sanctionedImos = new Set<string>();
  const sanctionedMmsis = new Set<string>();
  const shadowImos = new Set<string>();
  const rows: OpenSanctionsVesselRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]).map((c) => c.replace(/^"|"$/g, ''));
    const type = (iType >= 0 ? cols[iType] : '').toUpperCase();
    if (type !== 'VESSEL') continue;
    const risk = (iRisk >= 0 ? cols[iRisk] : '').toLowerCase();
    const isSanction = risk.includes('sanction');
    const isShadow = risk.includes('shadow') || risk.includes('mare.shadow');
    if (!isSanction && !isShadow) continue;

    const imoRaw = iImo >= 0 ? cols[iImo] : '';
    const mmsiRaw = iMmsi >= 0 ? cols[iMmsi] : '';
    const imoMatch = String(imoRaw).match(/\d{7}/);
    const mmsiMatch = String(mmsiRaw).match(/\d{9}/);
    const imo = imoMatch ? imoMatch[0] : '';
    const mmsi = mmsiMatch ? mmsiMatch[0] : '';
    if (!imo && !mmsi) continue;

    if (isSanction && imo) sanctionedImos.add(imo);
    if (isSanction && mmsi) sanctionedMmsis.add(mmsi);
    if (isShadow && imo) shadowImos.add(imo);

    rows.push({
      imo,
      mmsi,
      name: iCaption >= 0 ? cols[iCaption] : '',
      risk: iRisk >= 0 ? cols[iRisk] : '',
      flag: iFlag >= 0 ? cols[iFlag] : '',
      url: iUrl >= 0 ? cols[iUrl] : '',
      datasets: iDatasets >= 0 ? cols[iDatasets] : '',
    });
  }

  // Persist lean local copy for runtime matching
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = 'imo,mmsi,name,risk,flag,url,datasets\n';
  const body = rows
    .map((row) =>
      [row.imo, row.mmsi, esc(row.name), esc(row.risk), esc(row.flag), esc(row.url), esc(row.datasets)].join(
        ','
      )
    )
    .join('\n');
  fs.writeFileSync(OPENSANCTIONS_VESSELS_CSV, header + body + '\n', 'utf8');

  const euMissingFromOpenSanctions = [...euImos].filter((imo) => !sanctionedImos.has(imo)).slice(0, 40);
  const openSanctionsNotInEuSample = [...sanctionedImos].filter((imo) => !euImos.has(imo)).slice(0, 40);

  console.log(
    `[sanctions] OpenSanctions vessels sanc_imo=${sanctionedImos.size} sanc_mmsi=${sanctionedMmsis.size} shadow_imo=${shadowImos.size} eu_overlap=${euImos.size - euMissingFromOpenSanctions.length}`
  );

  return {
    rows,
    sanctionedImos,
    sanctionedMmsis,
    shadowImos,
    euOverlap: [...euImos].filter((imo) => sanctionedImos.has(imo)).length,
    euMissingFromOpenSanctions,
    openSanctionsNotInEuSample,
  };
}

export function readOpenSanctionsVesselIds(filePath = OPENSANCTIONS_VESSELS_CSV): {
  imos: Set<string>;
  mmsis: Set<string>;
} {
  const imos = new Set<string>();
  const mmsis = new Set<string>();
  if (!fs.existsSync(filePath)) return { imos, mmsis };
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { imos, mmsis };
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const risk = (cols[3] || '').toLowerCase();
    if (!risk.includes('sanction')) continue;
    const imo = parseImo(cols[0]);
    if (imo) imos.add(imo);
    const mmsi = String(cols[1] || '').match(/\d{9}/);
    if (mmsi) mmsis.add(mmsi[0]);
  }
  return { imos, mmsis };
}

/**
 * Merge DMA list into local EU designated CSV (additive: never drops existing IMOs).
 * Cross-checks FleetLeaks changelog for IMOs mentioned there but missing locally.
 */
export async function updateEuDesignatedVessels(): Promise<SanctionsUpdateResult> {
  const updatedAt = new Date().toISOString();
  try {
    const existing = readEuDesignatedCsv();
    const before = new Set(existing.keys());

    const page = await axios.get(DMA_PAGE_URL, {
      timeout: 30000,
      headers: { 'User-Agent': 'SvalMap-sanctions-updater/1.0' },
      responseType: 'text',
    });
    const dmaFileUrl = findDmaListUrl(String(page.data || ''));
    if (!dmaFileUrl) {
      throw new Error('Could not find DMA vessel list download link on designations page');
    }

    let dmaRows: EuVesselRow[] = [];
    if (/\.csv$/i.test(dmaFileUrl)) {
      const file = await axios.get(dmaFileUrl, {
        timeout: 60000,
        responseType: 'text',
        headers: { 'User-Agent': 'SvalMap-sanctions-updater/1.0' },
      });
      dmaRows = parseDmaCsv(String(file.data || ''));
    } else {
      // XLSX: download to temp and parse via python openpyxl if available
      const tmp = path.join(DATA_DIR, '.dma-eu-tmp.xlsx');
      const file = await axios.get(dmaFileUrl, {
        timeout: 120000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'SvalMap-sanctions-updater/1.0' },
      });
      fs.writeFileSync(tmp, Buffer.from(file.data));
      const { execFileSync } = await import('child_process');
      const out = execFileSync(
        'python3',
        [
          '-c',
          `
import openpyxl, json, re
wb=openpyxl.load_workbook(${JSON.stringify(tmp)}, data_only=True)
ws=wb.active
rows=[]
for row in ws.iter_rows(min_row=2, values_only=True):
  vals=list(row)
  imo=None; name=''; date=''
  for v in vals:
    m=re.search(r'\\b(\\d{7})\\b', str(v or ''))
    if m and imo is None: imo=m.group(1)
  if len(vals)>1 and vals[1]: name=str(vals[1]).strip()
  for v in vals:
    s=str(v or '')
    if re.search(r'\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}', s): date=s; break
  if imo: rows.append({'imo':imo,'name':name,'date_of_application':date,'eu_oj_link':'','source':'dma-weekly'})
print(json.dumps(rows))
`,
        ],
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
      );
      dmaRows = JSON.parse(out);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }

    const added: string[] = [];
    for (const r of dmaRows) {
      if (!existing.has(r.imo)) {
        existing.set(r.imo, r);
        added.push(r.imo);
      }
    }

    const merged = [...existing.values()].sort((a, b) => a.imo.localeCompare(b.imo));
    writeEuDesignatedCsv(merged);

    const fleetImos = await extractFleetleaksImos();
    const fleetleaksNotInList = fleetImos.filter((imo) => !existing.has(imo)).slice(0, 50);

    let openSanctionsMeta: SanctionsUpdateResult['openSanctions'];
    try {
      const os = await updateOpenSanctionsVessels(new Set(existing.keys()));
      openSanctionsMeta = {
        sanctionedImos: os.sanctionedImos.size,
        sanctionedMmsis: os.sanctionedMmsis.size,
        shadowImos: os.shadowImos.size,
        euOverlap: os.euOverlap,
        euMissingFromOpenSanctions: os.euMissingFromOpenSanctions,
        openSanctionsNotInEuSample: os.openSanctionsNotInEuSample,
      };
    } catch (e: any) {
      console.warn('[sanctions] OpenSanctions update failed', e?.message || e);
      openSanctionsMeta = undefined;
    }

    writeMeta({
      updated_at: updatedAt,
      imo_count: merged.length,
      last_dma_file: dmaFileUrl,
      last_added_count: added.length,
      last_added_imos: added.slice(0, 40),
      fleetleaks_imos_mentioned: fleetImos.length,
      fleetleaks_not_in_list_sample: fleetleaksNotInList,
      opensanctions: openSanctionsMeta || null,
      opensanctions_search: OPENSANCTIONS_SEARCH_URL,
      opensanctions_bulk: OPENSANCTIONS_MARITIME_CSV_URL,
      before_count: before.size,
    });

    console.log(
      `[sanctions] DMA update ok imos=${merged.length} added=${added.length} fleetleaks_extra=${fleetleaksNotInList.length} os_sanc=${openSanctionsMeta?.sanctionedImos ?? 'n/a'}`
    );

    return {
      ok: true,
      imoCount: merged.length,
      added,
      dmaFileUrl,
      fleetleaksImosMentioned: fleetImos.length,
      fleetleaksNotInList,
      openSanctions: openSanctionsMeta,
      updatedAt,
    };
  } catch (e: any) {
    const error = e?.message || String(e);
    console.warn('[sanctions] update failed', error);
    writeMeta({ last_error: error, last_error_at: updatedAt });
    return {
      ok: false,
      imoCount: readEuDesignatedCsv().size,
      added: [],
      fleetleaksImosMentioned: 0,
      fleetleaksNotInList: [],
      error,
      updatedAt,
    };
  }
}

export function metaAgeMs(): number | null {
  try {
    const m = JSON.parse(fs.readFileSync(EU_DESIGNATED_META, 'utf8'));
    const t = Date.parse(m.updated_at || '');
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
  } catch {
    return null;
  }
}
