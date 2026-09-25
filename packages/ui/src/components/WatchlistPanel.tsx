'use client';

import React from 'react';
import type { WatchlistEntry, WatchlistState } from '../utils/watchlists';

type Props = {
  state: WatchlistState;
  onOpen: (mmsi: string) => void;
  onRemove: (mmsi: string) => void;
  className?: string;
};

export default function WatchlistPanel({ state, onOpen, onRemove, className = '' }: Props) {
  const entries = state.entries;
  if (!entries.length) {
    return (
      <div className={`watchlist-panel empty ${className}`.trim()}>
        <div className="item hint">Watchlist empty — add from vessel detail</div>
      </div>
    );
  }
  return (
    <div className={`watchlist-panel ${className}`.trim()}>
      <div className="item hint">Watchlist ({entries.length})</div>
      <ul className="watchlist-list">
        {entries.map((e: WatchlistEntry) => (
          <li key={e.mmsi}>
            <button type="button" className="watchlist-open" onClick={() => onOpen(e.mmsi)}>
              <span className="vs-name">{e.name}</span>
              <span className="vs-meta">
                {e.mmsi}
                {e.note ? ` · ${e.note.slice(0, 40)}${e.note.length > 40 ? '…' : ''}` : ''}
              </span>
            </button>
            <button
              type="button"
              className="watchlist-remove"
              title="Remove"
              onClick={() => onRemove(e.mmsi)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
