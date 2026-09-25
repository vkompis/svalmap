'use client';

import React, { useEffect, useState } from 'react';
import axios from 'axios';

export type LiveIncident = {
  id: string;
  type: 'proximity' | 'loiter';
  title: string;
  message: string;
  mmsi: string[];
  lon: number;
  lat: number;
  distanceNm?: number;
  speed?: number;
};

type Props = {
  apiBase: string;
  enabled: boolean;
  onFocus?: (incident: LiveIncident) => void;
  className?: string;
};

export default function LiveIncidentsPanel({
  apiBase,
  enabled,
  onFocus,
  className = '',
}: Props) {
  const [items, setItems] = useState<LiveIncident[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const { data } = await axios.get(`${apiBase}/api/incidents/live`, {
          timeout: 20000,
        });
        if (!cancelled) {
          setItems(Array.isArray(data?.incidents) ? data.incidents : []);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed');
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiBase, enabled]);

  if (!enabled) return null;

  return (
    <div className={`live-incidents ${className}`.trim()}>
      <div className="item hint">Proximity &amp; loiter (live AIS)</div>
      {error && <div className="item hint warn">{error}</div>}
      {!error && !items.length && <div className="item hint">No hits right now</div>}
      <ul className="watchlist-list">
        {items.slice(0, 12).map((inc) => (
          <li key={inc.id}>
            <button
              type="button"
              className="watchlist-open"
              onClick={() => onFocus?.(inc)}
            >
              <span className="vs-name">{inc.title}</span>
              <span className="vs-meta">{inc.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
