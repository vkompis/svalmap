'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type {
  OverlayVisibility,
  GfwVisibility,
  VesselFeatureProps,
  GfwEventProps,
  VesselLayerStatus,
  CableFeatureProps,
  NavWarningProps,
  AreaAlertRule,
  VesselFilterFlags,
  WatchlistState,
} from '@svalmap/ui';
import {
  HEADER_COLORS,
  headerTextColor,
  navStatusLabel,
  AlertPanel,
  ShipPhoto,
  VesselSearch,
  WatchlistPanel,
  LiveIncidentsPanel,
  DEFAULT_VESSEL_FILTERS,
  SAR_MATCHED_FLAG_OPTIONS,
  loadWatchlist,
  saveWatchlist,
  upsertWatchEntry,
  removeWatchEntry,
  setVesselNote,
  exportVesselPack,
  exportGeoJSONSnapshot,
  parseUrlState,
  writeUrlState,
  copyShareUrl,
  anyFilterActive,
} from '@svalmap/ui';

const MapCanvas = dynamic(() => import('./MapCanvas'), { ssr: false });

const PREFS_KEY = 'svalmap.layerPrefs.v4';

const DEFAULT_OVERLAYS: OverlayVisibility = {
  'eez-norway': false,
  'eez-janmayen': false,
  'eez-svalbard': false,
  cables: false,
  'cables-telegeography': false,
  petroleum: false,
  nsm: false,
  skytefelt: false,
  ports: false,
  airports: false,
  'ice-edge': false,
  navwarnings: false,
  'navwarnings-30d': false,
};

const DEFAULT_GFW: GfwVisibility = {
  loitering: false,
  encounters: false,
  aisoff: true,
  port: false,
  sarUnmatched: true,
  sarMatched: true,
  sarMatchedFlags: [],
  viirs: false,
};

const GFW_HEADER_COLORS: Record<string, string> = {
  loitering: '#f6a21a',
  encounter: '#ff3b30',
  ais_off: '#a855f7',
  port_visit: '#22c55e',
  sar: '#f59e0b',
  sar_matched: '#4ade80',
  viirs: '#c9a000',
};

type DetailSelection =
  | { kind: 'vessel'; vessel: VesselFeatureProps }
  | { kind: 'gfw'; event: GfwEventProps }
  | { kind: 'cable'; cable: CableFeatureProps }
  | { kind: 'navwarning'; warning: NavWarningProps };

function formatWhen(iso: string | null | undefined) {
  if (!iso) return 'Not available';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function LayerRow({
  label,
  icon,
  checked,
  onChange,
  iconAlt,
}: {
  label: string;
  icon?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  iconAlt?: string;
}) {
  return (
    <label className="item item-toggle">
      <span className="label">{label}</span>
      <span className="spacer" />
      {icon ? <img className="menu-icon" src={icon} alt={iconAlt || ''} /> : null}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export default function HomePage() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [eaOpen, setEaOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [navWarningsOpen, setNavWarningsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const [shipsVisible, setShipsVisible] = useState(true);
  const [overlays, setOverlays] = useState<OverlayVisibility>(DEFAULT_OVERLAYS);
  const [gfw, setGfw] = useState<GfwVisibility>(DEFAULT_GFW);
  const [prefsReady, setPrefsReady] = useState(false);
  const [aisStatus, setAisStatus] = useState<VesselLayerStatus>({
    vesselCount: 0,
    lastUpdate: null,
    error: null,
    trackStatus: 'idle',
    trackError: null,
  });
  const [alertDraft, setAlertDraft] = useState<{ mmsi: string; name: string } | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [drawingAoi, setDrawingAoi] = useState(false);
  const [draftRing, setDraftRing] = useState<number[][]>([]);
  const [alertRules, setAlertRules] = useState<AreaAlertRule[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [vesselFilters, setVesselFilters] = useState<VesselFilterFlags>(DEFAULT_VESSEL_FILTERS);
  const [trackDays, setTrackDays] = useState(1);
  const [watchlist, setWatchlist] = useState<WatchlistState>({ entries: [], notes: {} });
  const [liveVessels, setLiveVessels] = useState<VesselFeatureProps[]>([]);
  const [showIncidents, setShowIncidents] = useState(false);
  const [healthMeta, setHealthMeta] = useState<any>(null);
  const [sanctionsInfo, setSanctionsInfo] = useState<any>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [pendingMmsi, setPendingMmsi] = useState<string | null>(null);

  const mapStyle =
    process.env.NEXT_PUBLIC_MAP_STYLE ||
    'https://api.maptiler.com/maps/01a0da39-c5b8-768c-abcd-1e06869c3fda/style.json';
  const attribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
    '© MapTiler © OpenStreetMap contributors';
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
  // If style URL is MapTiler without ?key=, append it
  const mapStyleWithKey =
    maptilerKey &&
    mapStyle.includes('api.maptiler.com') &&
    !/[?&]key=/.test(mapStyle)
      ? `${mapStyle}${mapStyle.includes('?') ? '&' : '?'}key=${maptilerKey}`
      : mapStyle;
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.overlays) {
          setOverlays({
            ...DEFAULT_OVERLAYS,
            ...p.overlays,
            airports: false,
            // Always start with nav warnings off (enable in session as needed)
            navwarnings: false,
            'navwarnings-30d': false,
          });
        }
        if (p.gfw) {
          const legacySar = (p.gfw as { sar?: boolean }).sar;
          const rawFlags = (p.gfw as { sarMatchedFlags?: unknown }).sarMatchedFlags;
          setGfw({
            ...DEFAULT_GFW,
            ...p.gfw,
            viirs: false,
            // Free dark-vessel layers — on by default so AIS-off / SAR are visible
            aisoff: true,
            sarUnmatched:
              typeof p.gfw.sarUnmatched === 'boolean'
                ? p.gfw.sarUnmatched
                : legacySar !== false,
            sarMatched:
              typeof p.gfw.sarMatched === 'boolean'
                ? p.gfw.sarMatched
                : legacySar !== false,
            sarMatchedFlags: Array.isArray(rawFlags)
              ? rawFlags
                  .map((f) => String(f || '').trim().toUpperCase())
                  .filter((f) => /^[A-Z]{3}$/.test(f))
              : [],
          });
        }
        if (typeof p.shipsVisible === 'boolean') setShipsVisible(p.shipsVisible);
        if (typeof p.drawerOpen === 'boolean') setDrawerOpen(p.drawerOpen);
        if (p.vesselFilters) setVesselFilters({ ...DEFAULT_VESSEL_FILTERS, ...p.vesselFilters });
        if (typeof p.trackDays === 'number') setTrackDays(Math.max(1, Math.min(14, p.trackDays)));
        if (typeof p.showIncidents === 'boolean') setShowIncidents(p.showIncidents);
      }
      setWatchlist(loadWatchlist());
      setLegendOpen(false);
      setNavWarningsOpen(false);
      const url = parseUrlState();
      if (url.mmsi) setPendingMmsi(url.mmsi);
      if (typeof url.ships === 'boolean') setShipsVisible(url.ships);
      if (url.trackDays) setTrackDays(url.trackDays);
      if (url.filters?.length) {
        setVesselFilters({
          ...DEFAULT_VESSEL_FILTERS,
          sanctioned: url.filters.includes('sanctioned'),
          shadow: url.filters.includes('shadow'),
          research: url.filters.includes('research'),
          military: url.filters.includes('military'),
          russian: url.filters.includes('russian'),
        });
      }
      if (url.navActive) {
        setOverlays((o) => ({ ...o, navwarnings: true }));
        setNavWarningsOpen(true);
      }
      if (url.nav30d) {
        setOverlays((o) => ({ ...o, 'navwarnings-30d': true }));
        setNavWarningsOpen(true);
      }
    } catch {
      /* ignore */
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          overlays,
          gfw,
          shipsVisible,
          drawerOpen,
          vesselFilters,
          trackDays,
          showIncidents,
        })
      );
    } catch {
      /* ignore */
    }
  }, [overlays, gfw, shipsVisible, drawerOpen, vesselFilters, trackDays, showIncidents, prefsReady]);

  useEffect(() => {
    saveWatchlist(watchlist);
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch(`${apiBase}/api/health`, { cache: 'no-store' });
        if (!cancelled) {
          setApiOk(r.ok);
          if (r.ok) {
            const j = await r.json();
            setHealthMeta(j);
          }
        }
      } catch {
        if (!cancelled) setApiOk(false);
      }
    };
    ping();
    const t = setInterval(ping, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiBase]);

  const setOverlay = (key: keyof OverlayVisibility, on: boolean) => {
    setOverlays((prev) => ({ ...prev, [key]: on }));
  };
  const setGfwFlag = (
    key: Exclude<keyof GfwVisibility, 'sarMatchedFlags'>,
    on: boolean
  ) => {
    setGfw((prev) => ({ ...prev, [key]: on }));
  };

  const toggleSarMatchedFlag = (code: string) => {
    const c = code.toUpperCase();
    setGfw((prev) => {
      const cur = new Set(prev.sarMatchedFlags || []);
      if (cur.has(c)) cur.delete(c);
      else cur.add(c);
      return { ...prev, sarMatchedFlags: [...cur] };
    });
  };

  const closeDetail = useCallback(() => {
    setDetailDrawerOpen(false);
    setSelection(null);
    setPendingMmsi(null);
    setSanctionsInfo(null);
  }, []);

  const openGfwEvent = (event: GfwEventProps) => {
    setSelection({ kind: 'gfw', event });
    setDetailDrawerOpen(true);
    setAlertsExpanded(false);
  };
  const openCable = (cable: CableFeatureProps) => {
    setSelection({ kind: 'cable', cable });
    setDetailDrawerOpen(true);
    setAlertsExpanded(false);
  };
  const openNavWarning = (warning: NavWarningProps) => {
    setSelection({ kind: 'navwarning', warning });
    setDetailDrawerOpen(true);
    setAlertsExpanded(false);
  };

  const openVessel = useCallback((vessel: VesselFeatureProps) => {
    setSelection({ kind: 'vessel', vessel });
    setDetailDrawerOpen(true);
    setAlertsExpanded(false);
    setPendingMmsi(null);
  }, []);

  const selectedMmsi =
    selection?.kind === 'vessel' ? selection.vessel.mmsi : pendingMmsi;

  useEffect(() => {
    if (!prefsReady) return;
    const filterKeys = (
      ['sanctioned', 'shadow', 'research', 'military', 'russian'] as const
    ).filter((k) => vesselFilters[k]);
    writeUrlState({
      mmsi: selectedMmsi,
      ships: shipsVisible,
      trackDays,
      filters: filterKeys,
      navActive: overlays.navwarnings,
      nav30d: overlays['navwarnings-30d'],
    });
  }, [
    prefsReady,
    selectedMmsi,
    shipsVisible,
    trackDays,
    vesselFilters,
    overlays.navwarnings,
    overlays['navwarnings-30d'],
  ]);

  // Resolve deep-linked MMSI once live vessels arrive
  useEffect(() => {
    if (!pendingMmsi || selection?.kind === 'vessel') return;
    const hit = liveVessels.find((v) => v.mmsi === pendingMmsi);
    if (hit) openVessel(hit);
  }, [pendingMmsi, liveVessels, selection, openVessel]);

  // Sanctions dossier for selected vessel
  useEffect(() => {
    if (selection?.kind !== 'vessel') {
      setSanctionsInfo(null);
      return;
    }
    const v = selection.vessel;
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams();
        if (v.mmsi) q.set('mmsi', v.mmsi);
        if (v.imo) q.set('imo', v.imo);
        const r = await fetch(`${apiBase}/api/sanctions/lookup?${q}`, { cache: 'no-store' });
        const j = await r.json();
        if (!cancelled) setSanctionsInfo(j);
      } catch {
        if (!cancelled) setSanctionsInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, apiBase]);

  const anyGfw =
    gfw.loitering ||
      gfw.encounters ||
      gfw.aisoff ||
      gfw.port ||
      gfw.sarUnmatched ||
      gfw.sarMatched;

  const statusLabel = useMemo(() => {
    if (aisStatus.error) return 'AIS error';
    if (aisStatus.lastUpdate) {
      const t = new Date(aisStatus.lastUpdate);
      return `${aisStatus.vesselCount} vessels · ${t.toLocaleTimeString()}`;
    }
    return 'Connecting…';
  }, [aisStatus]);

  const freshnessHint = useMemo(() => {
    const parts: string[] = [];
    if (healthMeta?.sanctions?.cacheAgeMs != null) {
      const h = Math.round(healthMeta.sanctions.cacheAgeMs / 3600000);
      parts.push(`sanctions ~${h}h`);
    }
    if (healthMeta?.aisstream?.connected != null) {
      parts.push(healthMeta.aisstream.connected ? 'AISStream up' : 'AISStream down');
    }
    return parts.join(' · ');
  }, [healthMeta]);

  const closeColor =
    selection?.kind === 'vessel'
      ? headerTextColor(selection.vessel.category)
      : selection?.kind === 'cable' || selection?.kind === 'navwarning'
        ? '#fff'
        : '#fff';

  const setFilterFlag = (key: keyof VesselFilterFlags, on: boolean) => {
    setVesselFilters((prev) => ({ ...prev, [key]: on }));
  };

  return (
    <div
      className={`relative w-full h-screen overflow-hidden ${drawerOpen ? 'layers-open' : ''}`}
    >
      <header className="app-chrome" aria-label="SvalMap status">
        <div className="brand">SvalMap</div>
        <VesselSearch
          apiBase={apiBase}
          onSelect={(hit) => {
            openVessel({
              mmsi: hit.mmsi,
              name: hit.vessel_name || hit.name || '',
              label: hit.vessel_name || hit.name || `MMSI ${hit.mmsi}`,
              category: hit.research
                ? 'research'
                : hit.military
                  ? 'military'
                  : String(hit.mmsi).startsWith('273')
                    ? 'russia'
                    : 'rest',
              speed: null,
              imo: hit.imo || null,
              course: null,
              heading: null,
              destination: null,
              shipType: hit.shipType || null,
              status: null,
              eta: null,
              timestamp: null,
              sanctioned: hit.sanctioned ? 1 : 0,
              shadowfleet: hit.shadowfleet ? 1 : 0,
              military: hit.military ? 1 : 0,
              country: '',
              flag: 'xx',
              lon: hit.lon,
              lat: hit.lat,
            });
          }}
        />
        <div className="chrome-meta">
          <span
            className={`status-dot ${apiOk === false ? 'bad' : apiOk ? 'ok' : ''}`}
            title={apiOk === false ? 'API unreachable' : 'API ok'}
          />
          <span className="chrome-status">{statusLabel}</span>
          {freshnessHint && <span className="chrome-hint">{freshnessHint}</span>}
          {aisStatus.trackStatus === 'loading' && (
            <span className="chrome-hint">Loading {trackDays}d track…</span>
          )}
          {aisStatus.trackStatus === 'error' && aisStatus.trackError && (
            <span className="chrome-hint warn">{aisStatus.trackError}</span>
          )}
          <button
            type="button"
            className="chrome-btn"
            onClick={() => {
              copyShareUrl()
                .then(() => {
                  setShareHint('Link copied');
                  setTimeout(() => setShareHint(null), 2000);
                })
                .catch(() => setShareHint('Copy failed'));
            }}
          >
            {shareHint || 'Share'}
          </button>
        </div>
      </header>

      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="panel" role="navigation" aria-label="Map layers">
          <div className="header">
            <span className="title">SvalMap</span>
            <button
              id="collapse-btn"
              type="button"
              onClick={() => setDrawerOpen(false)}
              title="Collapse layers"
              aria-label="Collapse layers"
            >
              ‹
            </button>
          </div>

          <button
            type="button"
            className={`disclaimer-toggle ${coverageOpen ? 'open' : ''}`}
            onClick={() => setCoverageOpen((v) => !v)}
            aria-expanded={coverageOpen}
          >
            Data coverage
          </button>
          {coverageOpen && (
            <div className="disclaimer">
              Inside the Svalbard Fisheries Protection Zone: all registered vessels except fishing
              under 15&nbsp;m and recreational under 45&nbsp;m (when length is known). Elsewhere in
              the North Atlantic north of 54°N: Russian vessels, curated research vessels, shadow
              fleet, sanctioned vessels, and military / law enforcement (AIS type or Norwegian
              military MMSI list). Live AIS via AISStream + BarentsWatch (~20&nbsp;s refresh).
            </div>
          )}

          <div className="section">
            {/* —— Vessels —— */}
            <div className="section-header">Vessels</div>
            <LayerRow
              label="Ships"
              icon="/menu/Ships.svg"
              checked={shipsVisible}
              onChange={setShipsVisible}
            />
            <label className="item item-toggle">
              <span className="label">Track lookback</span>
              <span className="spacer" />
              <select
                className="track-days-select"
                value={trackDays}
                onChange={(e) => setTrackDays(Number(e.target.value))}
                disabled={!shipsVisible}
                title="BarentsWatch historic AIS, max 14 days"
              >
                {[1, 2, 3, 5, 7, 10, 14].map((d) => (
                  <option key={d} value={d}>
                    {d}d
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`disclaimer-toggle ${filtersOpen ? 'open' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
            >
              Filters
              {anyFilterActive(vesselFilters) ? ' · on' : ''}
            </button>
            {filtersOpen && (
              <div className="group">
                <div className="item hint">
                  {anyFilterActive(vesselFilters)
                    ? 'Showing flagged matches only'
                    : 'Off = all live vessels in coverage'}
                </div>
                <LayerRow
                  label="Sanctioned"
                  checked={vesselFilters.sanctioned}
                  onChange={(on) => setFilterFlag('sanctioned', on)}
                />
                <LayerRow
                  label="Shadow fleet"
                  checked={vesselFilters.shadow}
                  onChange={(on) => setFilterFlag('shadow', on)}
                />
                <LayerRow
                  label="Research"
                  checked={vesselFilters.research}
                  onChange={(on) => setFilterFlag('research', on)}
                />
                <LayerRow
                  label="Military"
                  checked={vesselFilters.military}
                  onChange={(on) => setFilterFlag('military', on)}
                />
                <LayerRow
                  label="Russian vessels (MID 273)"
                  checked={vesselFilters.russian}
                  onChange={(on) => setFilterFlag('russian', on)}
                />
              </div>
            )}
            {filtersOpen && (
              <div className="item hint">
                MID = first 3 digits of MMSI (Maritime Identification Digits). Russian ships use
                273…
              </div>
            )}

            <WatchlistPanel
              state={watchlist}
              onOpen={(mmsi) => {
                const hit = liveVessels.find((v) => v.mmsi === mmsi);
                if (hit) openVessel(hit);
                else setPendingMmsi(mmsi);
              }}
              onRemove={(mmsi) => setWatchlist((s) => removeWatchEntry(s, mmsi))}
            />

            <LayerRow
              label="Live heuristics"
              checked={showIncidents}
              onChange={setShowIncidents}
            />
            <LiveIncidentsPanel
              apiBase={apiBase}
              enabled={showIncidents}
              onFocus={(inc) => {
                const mmsi = inc.mmsi[0];
                const hit = liveVessels.find((v) => v.mmsi === mmsi);
                if (hit) openVessel(hit);
                else setPendingMmsi(mmsi);
              }}
            />
            <button
              type="button"
              className="text-btn export-btn"
              onClick={() =>
                exportGeoJSONSnapshot({
                  vessels: liveVessels.map((v) => ({
                    type: 'Feature',
                    geometry: {
                      type: 'Point',
                      coordinates: [v.lon ?? 0, v.lat ?? 0],
                    },
                    properties: v,
                  })),
                  label: 'live vessels snapshot',
                })
              }
            >
              Export live vessels (GeoJSON)
            </button>

            {/* —— Maritime zones —— */}
            <div className="section-header">Maritime zones</div>
            <div className="item item-toggle">
              <span className="label">Economic areas</span>
              <button
                type="button"
                className="text-btn"
                onClick={() => setEaOpen((v) => !v)}
              >
                {eaOpen ? 'Hide' : 'Show'}
              </button>
              <span className="spacer" />
              <img className="menu-icon" src="/menu/EEZs.svg" alt="" />
            </div>
            <div className="group" style={{ display: eaOpen ? 'block' : 'none' }}>
              <LayerRow
                label="Norway EEZ"
                icon="/menu/EEZs.svg"
                checked={overlays['eez-norway']}
                onChange={(on) => setOverlay('eez-norway', on)}
              />
              <LayerRow
                label="Jan Mayen EEZ"
                icon="/menu/EEZs.svg"
                checked={overlays['eez-janmayen']}
                onChange={(on) => setOverlay('eez-janmayen', on)}
              />
              <LayerRow
                label="Svalbard FPZ"
                icon="/menu/EEZs.svg"
                checked={overlays['eez-svalbard']}
                onChange={(on) => setOverlay('eez-svalbard', on)}
              />
            </div>
            <LayerRow
              label="Ice edge"
              checked={overlays['ice-edge']}
              onChange={(on) => setOverlay('ice-edge', on)}
            />

            {/* —— Infrastructure —— */}
            <div className="section-header">Infrastructure</div>
            <LayerRow
              label="Nkom cables"
              icon="/menu/Underseacables.svg"
              checked={overlays.cables}
              onChange={(on) => setOverlay('cables', on)}
            />
            <LayerRow
              label="Named cables"
              icon="/menu/Underseacables.svg"
              checked={overlays['cables-telegeography']}
              onChange={(on) => setOverlay('cables-telegeography', on)}
            />
            <LayerRow
              label="Pipelines & oil rigs"
              icon="/menu/pipelines_and_oil_rigs.svg"
              checked={overlays.petroleum}
              onChange={(on) => setOverlay('petroleum', on)}
            />
            <LayerRow
              label="Ports"
              icon="/menu/ports.svg"
              checked={overlays.ports}
              onChange={(on) => setOverlay('ports', on)}
            />

            {/* —— Restricted areas —— */}
            <div className="section-header">Restricted areas</div>
            <LayerRow
              label="NSM restrictions"
              icon="/menu/NSMrestriction.svg"
              checked={overlays.nsm}
              onChange={(on) => setOverlay('nsm', on)}
            />
            <LayerRow
              label="Firing ranges"
              icon="/menu/Offshore_firing_range.svg"
              checked={overlays.skytefelt}
              onChange={(on) => setOverlay('skytefelt', on)}
            />

            {/* —— Nav warnings —— */}
            <div className="section-header">Navigation warnings</div>
            <button
              type="button"
              className={`disclaimer-toggle ${navWarningsOpen ? 'open' : ''}`}
              onClick={() => setNavWarningsOpen((v) => !v)}
              aria-expanded={navWarningsOpen}
            >
              Show options
              {(overlays.navwarnings || overlays['navwarnings-30d']) ? ' · on' : ''}
            </button>
            {navWarningsOpen && (
              <div className="group">
                <LayerRow
                  label="Active warnings"
                  checked={overlays.navwarnings}
                  onChange={(on) => setOverlay('navwarnings', on)}
                />
                <LayerRow
                  label="Last 30 days"
                  checked={overlays['navwarnings-30d']}
                  onChange={(on) => setOverlay('navwarnings-30d', on)}
                />
              </div>
            )}

            {/* —— GFW —— */}
            <div className="section-header">Fishing Watch</div>
            <div className="item hint">
              Events: RU / sanctioned / shadow · AIS-off &amp; SAR on by default (full AOI)
            </div>
            <LayerRow
              label="Loitering"
              checked={gfw.loitering}
              onChange={(on) => setGfwFlag('loitering', on)}
            />
            <LayerRow
              label="Encounters"
              checked={gfw.encounters}
              onChange={(on) => setGfwFlag('encounters', on)}
            />
            <LayerRow
              label="AIS off (gaps)"
              checked={gfw.aisoff}
              onChange={(on) => setGfwFlag('aisoff', on)}
            />
            <LayerRow
              label="Port visits"
              checked={gfw.port}
              onChange={(on) => setGfwFlag('port', on)}
            />
            <LayerRow
              label="SAR unmatched (possible dark)"
              checked={gfw.sarUnmatched}
              onChange={(on) => setGfwFlag('sarUnmatched', on)}
            />
            <LayerRow
              label="SAR matched to AIS"
              checked={gfw.sarMatched}
              onChange={(on) => setGfwFlag('sarMatched', on)}
            />
            {gfw.sarMatched && (
              <div className="item sar-flag-filter">
                <div className="sar-flag-filter-head">
                  Flag filter
                  <span className="sar-flag-filter-hint">
                    {gfw.sarMatchedFlags.length === 0
                      ? 'All countries'
                      : `${gfw.sarMatchedFlags.length} selected`}
                  </span>
                </div>
                <div className="sar-flag-grid">
                  {SAR_MATCHED_FLAG_OPTIONS.map((opt) => {
                    const on = gfw.sarMatchedFlags.includes(opt.code);
                    return (
                      <label key={opt.code} className={`sar-flag-chip ${on ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleSarMatchedFlag(opt.code)}
                        />
                        <span className="sar-flag-code">{opt.code}</span>
                        <span className="sar-flag-label">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
                {gfw.sarMatchedFlags.length > 0 && (
                  <button
                    type="button"
                    className="sar-flag-clear"
                    onClick={() => setGfw((prev) => ({ ...prev, sarMatchedFlags: [] }))}
                  >
                    Clear flag filter
                  </button>
                )}
              </div>
            )}
            {(gfw.sarUnmatched || gfw.sarMatched) && (
              <div className="item sar-key">
                {gfw.sarUnmatched && (
                  <span className="sar-key-row">
                    <span className="swatch gfw-sar" />
                    Amber — no AIS match (possible dark)
                  </span>
                )}
                {gfw.sarMatched && (
                  <span className="sar-key-row">
                    <span className="swatch gfw-sar-matched" />
                    Green — matched to AIS
                    {gfw.sarMatchedFlags.length > 0
                      ? ` · ${gfw.sarMatchedFlags.join(', ')}`
                      : ''}
                  </span>
                )}
                <span className="sar-key-note">
                  Last 30 days · Norway EEZ, Jan Mayen EEZ &amp; Svalbard FPZ · lags ~5 days
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="overlay" onClick={() => setDrawerOpen(false)} />
      </div>

      {!drawerOpen && (
        <button
          type="button"
          className="layers-fab"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open map layers"
          title="Map layers"
        >
          Layers
        </button>
      )}

      <div className="map-stage">
        <MapCanvas
          mapStyle={mapStyleWithKey}
          attribution={attribution}
          maptilerKey={maptilerKey}
          overlays={overlays}
          gfw={gfw}
          shipsVisible={shipsVisible}
          selectedMmsi={selectedMmsi}
          vesselFilters={vesselFilters}
          trackDays={trackDays}
          drawingAoi={drawingAoi}
          draftRing={draftRing}
          alertPolygons={alertRules
            .filter((r) => r.areaId === 'custom' && r.polygon && r.status === 'watching')
            .map((r) => ({ id: r.id, polygon: r.polygon!, label: r.areaLabel }))}
          onDraftPoint={(lon, lat) => {
            setDraftRing((prev) => [...prev, [lon, lat]]);
          }}
          onVesselSelect={openVessel}
          onGfwEventSelect={openGfwEvent}
          onCableSelect={drawingAoi ? undefined : openCable}
          onNavWarningSelect={drawingAoi ? undefined : openNavWarning}
          onDeselect={closeDetail}
          onVesselStatus={setAisStatus}
          onVesselsChange={setLiveVessels}
        />
      </div>

      <div
        className={`alerts-slot ${!alertsExpanded ? 'tucked' : ''}`}
      >
        <AlertPanel
          apiBase={apiBase}
          draftMmsi={alertDraft?.mmsi || null}
          draftName={alertDraft?.name || null}
          onDraftConsumed={() => setAlertDraft(null)}
          drawing={drawingAoi}
          onDrawingChange={setDrawingAoi}
          draftRing={draftRing}
          onDraftRingChange={setDraftRing}
          onRulesChange={setAlertRules}
          collapsed={!alertsExpanded}
          onExpand={() => setAlertsExpanded(true)}
          onCollapse={() => setAlertsExpanded(false)}
        />
      </div>

      <div
        id="detail-drawer"
        className={detailDrawerOpen ? 'open' : ''}
        role="dialog"
        aria-label="Selection details"
      >
        <div id="detail-card">
          {selection?.kind === 'vessel' && (() => {
            const selectedVessel = selection.vessel;
            return (
              <>
                <div
                  className="head"
                  style={{
                    background: HEADER_COLORS[selectedVessel.category] || HEADER_COLORS.rest,
                    color: headerTextColor(selectedVessel.category),
                  }}
                >
                  {selectedVessel.name || `MMSI ${selectedVessel.mmsi}`}
                  <div className="country">
                    <img
                      src={`/flag-icons/${selectedVessel.flag || 'xx'}.svg`}
                      alt=""
                      style={{ width: '14px', height: '10px' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {selectedVessel.country || 'Unknown'}
                  </div>
                  {!!selectedVessel.sanctioned && (
                    <div className="country" style={{ marginTop: 6 }}>
                      <img
                        src="/markers/Circles/Sanksjon.svg"
                        alt=""
                        style={{ width: 16, height: 12 }}
                      />
                      Sanctioned vessel
                    </div>
                  )}
                  {!!selectedVessel.shadowfleet && (
                    <div className="country" style={{ marginTop: 6 }}>
                      <img
                        src="/markers/Circles/shadowtriangle.svg"
                        alt=""
                        style={{ width: 16, height: 12 }}
                      />
                      Russian shadow fleet
                    </div>
                  )}
                  {selectedVessel.category === 'research' && (
                    <div className="country" style={{ marginTop: 6 }}>
                      <img
                        src="/markers/Circles/Researchcircle.svg"
                        alt=""
                        style={{ width: 14, height: 14 }}
                      />
                      Russian research vessel
                    </div>
                  )}
                </div>
                <div className="body">
                  <ShipPhoto
                    imo={selectedVessel.imo}
                    vesselName={selectedVessel.name}
                    proxyBase={apiBase}
                  />
                  <div className="row">
                    <span className="k">MMSI:</span>
                    <span className="v">{selectedVessel.mmsi || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">IMO:</span>
                    <span className="v">{selectedVessel.imo || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">Destination:</span>
                    <span className="v">{selectedVessel.destination || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">ETA:</span>
                    <span className="v">{selectedVessel.eta || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">Type:</span>
                    <span className="v">{selectedVessel.shipType || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">Time:</span>
                    <span className="v">
                      {selectedVessel.timestamp
                        ? new Date(selectedVessel.timestamp).toLocaleString()
                        : 'Not available'}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">Course:</span>
                    <span className="v">
                      {selectedVessel.course != null ? selectedVessel.course : 'Not available'}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">Speed:</span>
                    <span className="v">
                      {selectedVessel.speed != null
                        ? `${selectedVessel.speed} kn`
                        : 'Not available'}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">Navigational Status:</span>
                    <span className="v">{navStatusLabel(selectedVessel.status)}</span>
                  </div>
                  <div className="row">
                    <span className="k">True Heading:</span>
                    <span className="v">
                      {selectedVessel.heading != null
                        ? selectedVessel.heading
                        : 'Not available'}
                    </span>
                  </div>
                  {aisStatus.trackStatus === 'loading' && (
                    <div className="row muted">Loading {trackDays}d track…</div>
                  )}
                  {aisStatus.trackStatus === 'error' && (
                    <div className="row muted">{aisStatus.trackError}</div>
                  )}
                  {aisStatus.trackStatus === 'ready' && (
                    <div className="row muted">
                      Orange line: last {trackDays}d AIS track (BarentsWatch, Norwegian waters)
                    </div>
                  )}
                  {sanctionsInfo && (
                    <div className="sanctions-dossier">
                      <div className="row">
                        <span className="k">Sanctions match:</span>
                        <span className="v">
                          {sanctionsInfo.sanctioned ? 'Yes (list hit)' : 'No'}
                        </span>
                      </div>
                      <div className="row">
                        <span className="k">Shadow list:</span>
                        <span className="v">
                          {sanctionsInfo.shadowfleet ? 'Yes (list hit)' : 'No'}
                        </span>
                      </div>
                      {sanctionsInfo.sources?.length > 0 && (
                        <div className="row muted">
                          Sources: {sanctionsInfo.sources.join('; ')}
                        </div>
                      )}
                      <div className="row muted">{sanctionsInfo.disclaimer}</div>
                      {sanctionsInfo.opensanctionsUrl && (
                        <div className="row">
                          <a
                            href={sanctionsInfo.opensanctionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            OpenSanctions search
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  <label className="note-field">
                    <span className="k">Analyst note</span>
                    <textarea
                      rows={2}
                      value={watchlist.notes[selectedVessel.mmsi] || ''}
                      onChange={(e) =>
                        setWatchlist((s) => setVesselNote(s, selectedVessel.mmsi, e.target.value))
                      }
                      placeholder="Private note (saved locally)"
                    />
                  </label>
                  <div className="row detail-actions">
                    <button
                      type="button"
                      className="detail-action"
                      onClick={() => {
                        setWatchlist((s) =>
                          upsertWatchEntry(s, {
                            mmsi: selectedVessel.mmsi,
                            name: selectedVessel.name || `MMSI ${selectedVessel.mmsi}`,
                            imo: selectedVessel.imo,
                          })
                        );
                      }}
                    >
                      Add to watchlist
                    </button>
                    <button
                      type="button"
                      className="detail-action"
                      onClick={async () => {
                        let track: any = null;
                        try {
                          const r = await fetch(
                            `${apiBase}/api/tracks24h?mmsi=${encodeURIComponent(selectedVessel.mmsi)}&days=${trackDays}&interval=15`
                          );
                          track = await r.json();
                        } catch {
                          /* ignore */
                        }
                        exportVesselPack({
                          vessel: selectedVessel as any,
                          track,
                          sanctions: sanctionsInfo,
                          note: watchlist.notes[selectedVessel.mmsi] || null,
                        });
                      }}
                    >
                      Export pack
                    </button>
                    <button
                      type="button"
                      className="detail-action"
                      onClick={() => {
                        setAlertDraft({
                          mmsi: selectedVessel.mmsi,
                          name: selectedVessel.name || `MMSI ${selectedVessel.mmsi}`,
                        });
                        setAlertsExpanded(true);
                      }}
                    >
                      Create area alert
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
          {selection?.kind === 'gfw' && (() => {
            const ev = selection.event;
            const headerBg = GFW_HEADER_COLORS[ev.subtype] || '#334155';
            return (
              <>
                <div className="head" style={{ background: headerBg, color: '#fff' }}>
                  {ev.title}
                  <div className="country" style={{ marginTop: 6, opacity: 0.95 }}>
                    Global Fishing Watch
                  </div>
                  {ev.russian && (
                    <div className="country" style={{ marginTop: 6 }}>
                      Russian vessel
                    </div>
                  )}
                  {ev.sanctioned && (
                    <div className="country" style={{ marginTop: 6 }}>
                      <img
                        src="/markers/Circles/Sanksjon.svg"
                        alt=""
                        style={{ width: 16, height: 12 }}
                      />
                      Sanctioned vessel
                    </div>
                  )}
                  {ev.shadowfleet && (
                    <div className="country" style={{ marginTop: 6 }}>
                      <img
                        src="/markers/Circles/shadowtriangle.svg"
                        alt=""
                        style={{ width: 16, height: 12 }}
                      />
                      Russian shadow fleet
                    </div>
                  )}
                </div>
                <div className="body">
                  <div className="row">
                    <span className="k">Vessel(s):</span>
                    <span className="v">{ev.vessels || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">Flag:</span>
                    <span className="v">{ev.flag || 'Not available'}</span>
                  </div>
                  <div className="row">
                    <span className="k">MMSI:</span>
                    <span className="v">{ev.mmsi || 'Not available'}</span>
                  </div>
                  {ev.partnerMmsi && (
                    <div className="row">
                      <span className="k">Partner MMSI:</span>
                      <span className="v">{ev.partnerMmsi}</span>
                    </div>
                  )}
                  <div className="row">
                    <span className="k">Start:</span>
                    <span className="v">{formatWhen(ev.time)}</span>
                  </div>
                  <div className="row">
                    <span className="k">End:</span>
                    <span className="v">{formatWhen(ev.end)}</span>
                  </div>
                  <div className="row">
                    <span className="k">Duration:</span>
                    <span className="v">{ev.duration || 'Not available'}</span>
                  </div>
                  {(ev.subtype === 'sar' ||
                    ev.subtype === 'sar_matched' ||
                    ev.matched != null) && (
                    <div className="row">
                      <span className="k">AIS match:</span>
                      <span className="v">
                        {ev.matched === true
                          ? 'Matched'
                          : ev.matched === false || ev.subtype === 'sar'
                            ? 'Unmatched (possible dark)'
                            : 'Not available'}
                      </span>
                    </div>
                  )}
                  {ev.intentionalDisabling != null && (
                    <div className="row">
                      <span className="k">Intentional gap:</span>
                      <span className="v">{ev.intentionalDisabling ? 'Likely yes' : 'No / unknown'}</span>
                    </div>
                  )}
                  {ev.note && (
                    <div className="row muted">{ev.note}</div>
                  )}
                  <div className="row">
                    <span className="k">Position:</span>
                    <span className="v">
                      {Math.abs(ev.lat).toFixed(4)}°{ev.lat >= 0 ? 'N' : 'S'},{' '}
                      {Math.abs(ev.lon).toFixed(4)}°{ev.lon >= 0 ? 'E' : 'W'}
                    </span>
                  </div>
                </div>
              </>
            );
          })()}
          {selection?.kind === 'cable' && (() => {
            const c = selection.cable;
            return (
              <>
                <div
                  className="head"
                  style={{
                    background: c.color || (c.kind === 'nkom' ? '#0891b2' : '#db2777'),
                    color: '#fff',
                  }}
                >
                  {c.name}
                  <div className="country" style={{ marginTop: 6 }}>
                    {c.kind === 'landing' ? 'Landing point' : 'Submarine cable'}
                  </div>
                </div>
                <div className="body">
                  <div className="row">
                    <span className="k">Source:</span>
                    <span className="v">{c.source}</span>
                  </div>
                  <div className="row">
                    <span className="k">Id:</span>
                    <span className="v">{c.id}</span>
                  </div>
                  {c.kabeltype && (
                    <div className="row">
                      <span className="k">Type:</span>
                      <span className="v">{c.kabeltype}</span>
                    </div>
                  )}
                  {c.rfs_year != null && (
                    <div className="row">
                      <span className="k">RFS year:</span>
                      <span className="v">{c.rfs_year}</span>
                    </div>
                  )}
                  {c.is_planned && (
                    <div className="row">
                      <span className="k">Status:</span>
                      <span className="v">Planned</span>
                    </div>
                  )}
                  {c.kind === 'telegeography' && (
                    <div className="row muted">
                      © TeleGeography Submarine Cable Map (CC BY-NC-SA)
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          {selection?.kind === 'navwarning' && (() => {
            const w = selection.warning;
            return (
              <>
                <div className="head" style={{ background: '#b91c1c', color: '#fff' }}>
                  {w.title}
                  <div className="country" style={{ marginTop: 6 }}>
                    {w.kind === 'coastal' ? 'Coastal warning' : 'NAVAREA XIX'}
                    {w.status ? ` · ${w.status}` : ''}
                  </div>
                </div>
                <div className="body">
                  {w.warningnumber && (
                    <div className="row">
                      <span className="k">Number:</span>
                      <span className="v">{w.warningnumber}</span>
                    </div>
                  )}
                  {w.location && (
                    <div className="row">
                      <span className="k">Location:</span>
                      <span className="v">{w.location}</span>
                    </div>
                  )}
                  <div className="row">
                    <span className="k">Issued:</span>
                    <span className="v">{formatWhen(w.issued)}</span>
                  </div>
                  {w.updated_at && (
                    <div className="row">
                      <span className="k">Updated:</span>
                      <span className="v">{formatWhen(w.updated_at)}</span>
                    </div>
                  )}
                  {w.eventid != null && (
                    <div className="row">
                      <span className="k">Event id:</span>
                      <span className="v">{String(w.eventid)}</span>
                    </div>
                  )}
                  {w.message && (
                    <div className="row" style={{ display: 'block' }}>
                      <div className="k" style={{ marginBottom: 6 }}>
                        Message:
                      </div>
                      <div className="v" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                        {w.message}
                      </div>
                    </div>
                  )}
                  <div className="row muted">Source: Kystverket navigational warnings</div>
                </div>
              </>
            );
          })()}
          <button
            id="detail-close"
            type="button"
            onClick={closeDetail}
            aria-label="Close details"
            style={{ color: closeColor, background: 'rgba(0,0,0,0.25)' }}
          >
            ×
          </button>
        </div>
      </div>

      <div id="legend" className={legendOpen ? 'open' : 'collapsed'}>
        <button
          type="button"
          className="legend-toggle"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
        >
          Map key {legendOpen ? '▾' : '▴'}
        </button>
        {legendOpen && (
          <>
            {shipsVisible && (
              <>
                <div className="legend-section">Ships</div>
                <div className="indicators">
                  <div className="item">
                    <img
                      className="legend-icon shadow"
                      src="/markers/Circles/shadowtriangle.svg"
                      alt=""
                    />
                    Shadow fleet
                  </div>
                  <div className="item">
                    <img className="legend-icon" src="/markers/Circles/Sanksjon.svg" alt="" />
                    Sanctioned
                  </div>
                  <div className="item">
                    <img className="legend-icon" src="/markers/Circles/Militarycircle.svg" alt="" />
                    Military
                  </div>
                  <div className="item">
                    <img className="legend-icon" src="/markers/Circles/Researchcircle.svg" alt="" />
                    Research
                  </div>
                </div>
                <div className="row">
                  <div className="item">
                    <span className="swatch norway" />
                    Norway
                  </div>
                  <div className="item">
                    <span className="swatch russia" />
                    Russia
                  </div>
                  <div className="item">
                    <span className="swatch eu" />
                    EU
                  </div>
                  <div className="item">
                    <span className="swatch china" />
                    China
                  </div>
                  <div className="item">
                    <span className="swatch rest" />
                    Other
                  </div>
                </div>
              </>
            )}
            {(overlays['ice-edge'] ||
              overlays.navwarnings ||
              overlays['navwarnings-30d'] ||
              overlays['cables-telegeography'] ||
              overlays.cables ||
              selection?.kind === 'vessel') && (
              <>
                <div className="legend-section">Overlays</div>
                <div className="row extras">
                  {overlays['ice-edge'] && (
                    <div className="item">
                      <span className="line ice" />
                      Ice edge
                    </div>
                  )}
                  {(overlays.navwarnings || overlays['navwarnings-30d']) && (
                    <div className="item">
                      <span className="line nav" />
                      {overlays.navwarnings && overlays['navwarnings-30d']
                        ? 'Nav warnings'
                        : overlays.navwarnings
                          ? 'Active warnings'
                          : 'Warnings (30d)'}
                    </div>
                  )}
                  {overlays['cables-telegeography'] && (
                    <div className="item">
                      <span className="line tg-cable" />
                      Named cables
                    </div>
                  )}
                  {overlays.cables && (
                    <div className="item">
                      <span className="line nkom-cable" />
                      Nkom cables
                    </div>
                  )}
                  {selection?.kind === 'vessel' && (
                    <div className="item">
                      <span className="line track" />
                      Track
                    </div>
                  )}
                </div>
              </>
            )}
            {anyGfw && (
              <>
                <div className="legend-section">Fishing Watch</div>
                <div className="row extras">
                  {gfw.loitering && (
                    <div className="item">
                      <span className="swatch gfw-loiter" />
                      Loitering
                    </div>
                  )}
                  {gfw.encounters && (
                    <div className="item">
                      <span className="swatch gfw-enc" />
                      Encounter
                    </div>
                  )}
                  {gfw.aisoff && (
                    <div className="item">
                      <span className="swatch gfw-off" />
                      AIS off
                    </div>
                  )}
                  {gfw.port && (
                    <div className="item">
                      <span className="swatch gfw-port" />
                      Port visit
                    </div>
                  )}
                  {gfw.sarUnmatched && (
                    <div className="item">
                      <span className="swatch gfw-sar" />
                      SAR · no AIS (dark?)
                    </div>
                  )}
                  {gfw.sarMatched && (
                    <div className="item">
                      <span className="swatch gfw-sar-matched" />
                      SAR · matched AIS
                      {gfw.sarMatchedFlags.length > 0
                        ? ` (${gfw.sarMatchedFlags.join(', ')})`
                        : ''}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="legend-note">Zoom in for ship headings and names</div>
          </>
        )}
      </div>
    </div>
  );
}
