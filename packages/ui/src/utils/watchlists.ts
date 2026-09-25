/** Local watchlists + vessel notes (free, no backend required). */

export type WatchlistEntry = {
  mmsi: string;
  name: string;
  imo?: string | null;
  note?: string;
  addedAt: string;
};

export type WatchlistState = {
  entries: WatchlistEntry[];
  /** Free-form notes keyed by MMSI (including non-watchlisted). */
  notes: Record<string, string>;
};

export const WATCHLIST_KEY = 'svalmap.watchlist.v1';

export function loadWatchlist(): WatchlistState {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return { entries: [], notes: {} };
    const p = JSON.parse(raw);
    return {
      entries: Array.isArray(p.entries) ? p.entries : [],
      notes: p.notes && typeof p.notes === 'object' ? p.notes : {},
    };
  } catch {
    return { entries: [], notes: {} };
  }
}

export function saveWatchlist(state: WatchlistState) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function upsertWatchEntry(
  state: WatchlistState,
  entry: Omit<WatchlistEntry, 'addedAt'> & { addedAt?: string }
): WatchlistState {
  const mmsi = String(entry.mmsi).replace(/\D/g, '').padStart(9, '0').slice(-9);
  const rest = state.entries.filter((e) => e.mmsi !== mmsi);
  return {
    ...state,
    entries: [
      {
        mmsi,
        name: entry.name || `MMSI ${mmsi}`,
        imo: entry.imo ?? null,
        note: entry.note ?? state.notes[mmsi] ?? '',
        addedAt: entry.addedAt || new Date().toISOString(),
      },
      ...rest,
    ],
  };
}

export function removeWatchEntry(state: WatchlistState, mmsi: string): WatchlistState {
  const id = String(mmsi).replace(/\D/g, '').padStart(9, '0').slice(-9);
  return { ...state, entries: state.entries.filter((e) => e.mmsi !== id) };
}

export function setVesselNote(
  state: WatchlistState,
  mmsi: string,
  note: string
): WatchlistState {
  const id = String(mmsi).replace(/\D/g, '').padStart(9, '0').slice(-9);
  const notes = { ...state.notes };
  if (!note.trim()) delete notes[id];
  else notes[id] = note;
  const entries = state.entries.map((e) =>
    e.mmsi === id ? { ...e, note: note.trim() || undefined } : e
  );
  return { entries, notes };
}
