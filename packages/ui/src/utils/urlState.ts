/** Shareable URL state for deep links (no server required). */

export type UrlMapState = {
  mmsi?: string | null;
  ships?: boolean;
  trackDays?: number;
  filters?: string[]; // sanctioned,shadow,research,military,russian
  navActive?: boolean;
  nav30d?: boolean;
};

export function parseUrlState(search: string = typeof window !== 'undefined' ? window.location.search : ''): UrlMapState {
  const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const mmsi = q.get('mmsi');
  const ships = q.get('ships');
  const trackDays = q.get('days');
  const filters = q.get('filter');
  return {
    mmsi: mmsi ? mmsi.replace(/\D/g, '').padStart(9, '0').slice(-9) : null,
    ships: ships == null ? undefined : ships === '1' || ships === 'true',
    trackDays: trackDays ? Math.max(1, Math.min(14, parseInt(trackDays, 10) || 1)) : undefined,
    filters: filters
      ? filters
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : undefined,
    navActive: q.get('nav') === '1' || q.get('nav') === 'active',
    nav30d: q.get('nav') === '30d' || q.get('nav30') === '1',
  };
}

export function writeUrlState(state: UrlMapState, replace = true) {
  if (typeof window === 'undefined') return;
  const q = new URLSearchParams(window.location.search);
  if (state.mmsi) q.set('mmsi', state.mmsi);
  else q.delete('mmsi');
  if (state.ships === false) q.set('ships', '0');
  else if (state.ships === true) q.delete('ships');
  if (state.trackDays && state.trackDays > 1) q.set('days', String(state.trackDays));
  else q.delete('days');
  if (state.filters?.length) q.set('filter', state.filters.join(','));
  else q.delete('filter');
  if (state.navActive) q.set('nav', '1');
  else if (state.nav30d) q.set('nav', '30d');
  else {
    q.delete('nav');
    q.delete('nav30');
  }
  const next = `${window.location.pathname}${q.toString() ? `?${q}` : ''}${window.location.hash}`;
  if (replace) window.history.replaceState(null, '', next);
  else window.history.pushState(null, '', next);
}

export function copyShareUrl(): Promise<void> {
  const url = window.location.href;
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(url);
  return Promise.reject(new Error('Clipboard unavailable'));
}
