'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

export type VesselSearchHit = {
  mmsi: string;
  vessel_name?: string | null;
  name?: string | null;
  imo?: string | null;
  lon: number;
  lat: number;
  sanctioned?: boolean;
  shadowfleet?: boolean;
  military?: boolean;
  research?: boolean;
  shipType?: string | null;
};

type Props = {
  apiBase: string;
  onSelect: (hit: VesselSearchHit) => void;
  className?: string;
};

export default function VesselSearch({ apiBase, onSelect, className = '' }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<VesselSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setHits([]);
        return;
      }
      setLoading(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/vessels/search`, {
          params: { q: trimmed },
          timeout: 15000,
        });
        setHits(Array.isArray(data?.results) ? data.results : []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    },
    [apiBase]
  );

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(q), 220);
    return () => clearTimeout(timer.current);
  }, [q, search]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className={`vessel-search ${className}`.trim()} ref={boxRef}>
      <input
        type="search"
        placeholder="Search MMSI, IMO, name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        aria-label="Search vessels"
        autoComplete="off"
      />
      {loading && <span className="vessel-search-hint">…</span>}
      {open && hits.length > 0 && (
        <ul className="vessel-search-results" role="listbox">
          {hits.map((h) => (
            <li key={h.mmsi}>
              <button
                type="button"
                onClick={() => {
                  onSelect(h);
                  setQ(h.vessel_name || h.name || h.mmsi);
                  setOpen(false);
                }}
              >
                <span className="vs-name">{h.vessel_name || h.name || 'Unnamed'}</span>
                <span className="vs-meta">
                  {h.mmsi}
                  {h.imo ? ` · IMO ${h.imo}` : ''}
                  {h.sanctioned ? ' · sanctioned' : ''}
                  {h.shadowfleet ? ' · shadow' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && q.trim().length >= 2 && hits.length === 0 && (
        <div className="vessel-search-empty">No match in live set</div>
      )}
    </div>
  );
}
