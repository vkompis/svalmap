/** Compact ship hover card HTML (NAIS-inspired, dark SvalMap chrome). */

import {
  HEADER_COLORS,
  headerTextColor,
  type VesselCategory,
} from './vesselCategory';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDeg(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v.toFixed(digits)}°`;
}

function fmtSpeed(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)} kn`;
}

/** Degrees + decimal minutes, e.g. 76° 21.245' N */
export function formatLatLonDm(lat: number, lon: number): string {
  const fmt = (deg: number, pos: string, neg: string) => {
    const hemi = deg >= 0 ? pos : neg;
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${d}° ${m.toFixed(3)}' ${hemi}`;
  };
  return `${fmt(lat, 'N', 'S')}, ${fmt(lon, 'E', 'W')}`;
}

function relativeAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function sourceLabel(source: string | null | undefined): string {
  const s = String(source || '').toLowerCase();
  if (!s) return '';
  if (s.includes('aisstream')) return 'AISStream';
  if (s.includes('barents') || s.includes('kyst')) return 'coastal station';
  if (s.includes('gfw')) return 'GFW';
  return source as string;
}

export type VesselHoverInput = {
  mmsi?: string | null;
  name?: string | null;
  label?: string | null;
  category?: VesselCategory | string | null;
  country?: string | null;
  flag?: string | null;
  shipType?: string | null;
  heading?: number | null;
  course?: number | null;
  speed?: number | null;
  destination?: string | null;
  timestamp?: string | null;
  source?: string | null;
  lon?: number | null;
  lat?: number | null;
};

export function buildVesselHoverHtml(p: VesselHoverInput): string {
  const cat = (p.category as VesselCategory) || 'rest';
  const accent = HEADER_COLORS[cat] || HEADER_COLORS.rest;
  const titleColor = headerTextColor(cat in HEADER_COLORS ? cat : 'rest');
  const name = p.name || p.label || (p.mmsi ? `MMSI ${p.mmsi}` : 'Unknown vessel');
  const flag = (p.flag || 'xx').toLowerCase();
  const country = p.country || 'Unknown';
  const type =
    p.shipType && String(p.shipType).toLowerCase() !== 'not available'
      ? String(p.shipType)
      : null;
  const heading =
    p.heading != null && Number(p.heading) !== 511 ? Number(p.heading) : null;
  const course = p.course != null ? Number(p.course) : null;
  const dest = p.destination || null;
  const lon = p.lon != null ? Number(p.lon) : null;
  const lat = p.lat != null ? Number(p.lat) : null;
  const pos =
    lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)
      ? formatLatLonDm(lat, lon)
      : null;
  const when = p.timestamp
    ? new Date(p.timestamp).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;
  const age = relativeAge(p.timestamp || null);
  const via = sourceLabel(p.source);
  const updatedBits = [age, via ? `via ${via}` : ''].filter(Boolean).join(' · ');

  const markerBg =
    cat === 'rest' ? 'rgba(15,23,42,0.9)' : accent;

  return (
    `<div class="svalmap-ship-hover">` +
    `<div class="ssh-head">` +
    `<span class="ssh-marker" style="background:${esc(markerBg)};color:${esc(titleColor)}">◆</span>` +
    `<div class="ssh-title">` +
    `<div class="ssh-name">${esc(name)}</div>` +
    `<div class="ssh-flagline">` +
    `<img class="ssh-flag" src="/flag-icons/${esc(flag)}.svg" alt="" width="14" height="10" />` +
    `<span>${esc(country)}</span>` +
    `</div>` +
    `<div class="ssh-meta">` +
    (type ? `<span>${esc(type)}</span>` : '') +
    (type && p.mmsi ? `<span class="ssh-sep">·</span>` : '') +
    (p.mmsi ? `<span class="ssh-mmsi">${esc(p.mmsi)}</span>` : '') +
    `</div>` +
    `</div></div>` +
    `<div class="ssh-stats">` +
    `<div class="ssh-stat"><span class="ssh-k">Heading</span><span class="ssh-v">${esc(fmtDeg(heading, 0))}</span></div>` +
    `<div class="ssh-stat"><span class="ssh-k">Course</span><span class="ssh-v">${esc(fmtDeg(course, 0))}</span></div>` +
    `<div class="ssh-stat"><span class="ssh-k">Speed</span><span class="ssh-v">${esc(fmtSpeed(p.speed))}</span></div>` +
    `</div>` +
    `<div class="ssh-body">` +
    (dest
      ? `<div class="ssh-row"><span class="ssh-k">Destination</span><span class="ssh-v">${esc(dest)}</span></div>`
      : '') +
    (pos
      ? `<div class="ssh-row"><span class="ssh-k">Position</span><span class="ssh-v">${esc(pos)}</span></div>`
      : '') +
    (when
      ? `<div class="ssh-row"><span class="ssh-k">Updated</span><span class="ssh-v">${esc(when)}${
          updatedBits ? `<span class="ssh-age">${esc(updatedBits)}</span>` : ''
        }</span></div>`
      : '') +
    `</div></div>`
  );
}
