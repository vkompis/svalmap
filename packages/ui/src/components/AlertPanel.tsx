'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { pointInGeoJSON } from '../utils/geo';
import {
  ALERT_AREAS,
  type AlertAreaId,
  type AlertPolygon,
  type AreaAlertRule,
  createAlertRule,
  loadAlertRules,
  parseMmsiList,
  ruleWatchSummary,
  saveAlertRules,
} from '../utils/areaAlerts';

type Props = {
  apiBase?: string;
  draftMmsi?: string | null;
  draftName?: string | null;
  onDraftConsumed?: () => void;
  drawing: boolean;
  onDrawingChange: (on: boolean) => void;
  draftRing: number[][];
  onDraftRingChange: (ring: number[][]) => void;
  onRulesChange?: (rules: AreaAlertRule[]) => void;
  className?: string;
  collapsed?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
};

export default function AlertPanel({
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  draftMmsi = null,
  draftName = null,
  onDraftConsumed,
  drawing,
  onDrawingChange,
  draftRing,
  onDraftRingChange,
  onRulesChange,
  className = '',
  collapsed = false,
  onExpand,
  onCollapse,
}: Props) {
  const [rules, setRules] = useState<AreaAlertRule[]>([]);
  const [ready, setReady] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [mmsiText, setMmsiText] = useState('');
  const [watchAny, setWatchAny] = useState(false);
  const [areaId, setAreaId] = useState<AlertAreaId>('eez-svalbard');
  const [dwellMinutes, setDwellMinutes] = useState(0);
  const [watchHours, setWatchHours] = useState(24);
  const [email, setEmail] = useState('');
  const [smtpHint, setSmtpHint] = useState<string | null>(null);
  const areaCache = useRef<Record<string, any>>({});
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  useEffect(() => {
    setRules(loadAlertRules());
    setReady(true);
    axios
      .get(`${apiBase}/api/alerts/status`, { timeout: 8000 })
      .then((r) => {
        setSmtpHint(
          r.data?.emailConfigured
            ? 'Server email ready'
            : 'Email needs SMTP_* env on scripts-runner'
        );
      })
      .catch(() => setSmtpHint('Email server unreachable'));
  }, [apiBase]);

  useEffect(() => {
    if (!ready) return;
    saveAlertRules(rules);
    onRulesChange?.(rules);
  }, [rules, ready, onRulesChange]);

  useEffect(() => {
    if (draftMmsi) {
      setMmsiText((prev) => {
        const list = parseMmsiList(prev);
        const m = String(draftMmsi).replace(/\D/g, '');
        if (!list.includes(m.padStart(9, '0').slice(-9))) {
          return prev ? `${prev}, ${draftMmsi}` : String(draftMmsi);
        }
        return prev;
      });
      setWatchAny(false);
      setFormOpen(true);
      onExpand?.();
      onDraftConsumed?.();
    }
  }, [draftMmsi, draftName, onDraftConsumed, onExpand]);

  const loadArea = useCallback(
    async (rule: AreaAlertRule) => {
      if (rule.areaId === 'custom' && rule.polygon) {
        return { type: 'Feature', geometry: rule.polygon, properties: {} };
      }
      if (areaCache.current[rule.areaId]) return areaCache.current[rule.areaId];
      const def = ALERT_AREAS.find((a) => a.id === rule.areaId);
      if (!def) return null;
      const res = await fetch(`${apiBase}/overlays/${def.file}`);
      if (!res.ok) throw new Error(`Area load failed ${res.status}`);
      const gj = await res.json();
      areaCache.current[rule.areaId] = gj;
      return gj;
    },
    [apiBase]
  );

  const syncRuleToServer = useCallback(
    async (rule: AreaAlertRule) => {
      try {
        await axios.post(`${apiBase}/api/alerts`, rule, { timeout: 15000 });
      } catch (e: any) {
        console.warn('[AlertPanel] sync failed', e?.message || e);
      }
    },
    [apiBase]
  );

  // Push watching rules to disk-backed server once on load (durable watcher)
  useEffect(() => {
    if (!ready) return;
    for (const r of rules) {
      if (r.status === 'watching') syncRuleToServer(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, apiBase]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function tick() {
      const current = rulesRef.current;
      const watching = current.filter((r) => r.status === 'watching');
      if (!watching.length) return;

      let positions: any[] = [];
      try {
        const { data } = await axios.get(`${apiBase}/api/live-positions`, { timeout: 25000 });
        positions = Array.isArray(data) ? data : data?.data || [];
      } catch {
        return;
      }
      if (cancelled) return;

      const now = Date.now();
      let changed = false;
      const next: AreaAlertRule[] = [];

      for (const rule of current) {
        if (rule.status !== 'watching') {
          next.push(rule);
          continue;
        }

        const expires = new Date(rule.createdAt).getTime() + rule.watchHours * 3600_000;
        if (now > expires) {
          changed = true;
          next.push({
            ...rule,
            status: 'expired',
            message: `Watch ended (${rule.watchHours}h)`,
          });
          continue;
        }

        let gj: any;
        try {
          gj = await loadArea(rule);
        } catch {
          next.push(rule);
          continue;
        }

        const candidates =
          rule.mmsis.length === 0
            ? positions
            : positions.filter((v) => {
                const m = String(v.mmsi ?? '').replace(/\D/g, '').padStart(9, '0').slice(-9);
                return rule.mmsis.includes(m);
              });

        const insideSince = { ...rule.insideSince };
        const notified = [...rule.notified];
        let message = rule.message;
        let status: AreaAlertRule['status'] = rule.status;
        let triggeredAt = rule.triggeredAt;
        let lastEmailError = rule.lastEmailError;
        const vesselNames = { ...rule.vesselNames };

        const stillInside = new Set<string>();

        for (const v of candidates) {
          const mmsi = String(v.mmsi ?? '').replace(/\D/g, '').padStart(9, '0').slice(-9);
          if (!mmsi) continue;
          const lon = Number(v.lon ?? v.longitude);
          const lat = Number(v.lat ?? v.latitude);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          if (!pointInGeoJSON(lon, lat, gj)) continue;

          stillInside.add(mmsi);
          if (v.vessel_name || v.name) {
            vesselNames[mmsi] = String(v.vessel_name || v.name);
          }
          if (!insideSince[mmsi]) {
            insideSince[mmsi] = new Date().toISOString();
            changed = true;
          }

          const dwellMs = now - new Date(insideSince[mmsi]).getTime();
          const needMs = rule.dwellMinutes * 60_000;
          if (dwellMs < needMs) continue;
          if (notified.includes(mmsi)) continue;

          notified.push(mmsi);
          status = 'triggered';
          triggeredAt = new Date().toISOString();
          const name = vesselNames[mmsi] || `MMSI ${mmsi}`;
          message = `${name} entered ${rule.areaLabel}${
            rule.dwellMinutes > 0 ? ` (≥${rule.dwellMinutes} min)` : ''
          }`;
          changed = true;

          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('SvalMap area alert', { body: message });
            }
          } catch {
            /* ignore */
          }

          if (rule.email) {
            try {
              await axios.post(
                `${apiBase}/api/alerts/notify`,
                { ruleId: rule.id, mmsi, message, email: rule.email, rule },
                { timeout: 20000 }
              );
            } catch (e: any) {
              lastEmailError = e?.response?.data?.error || e?.message || 'Email failed';
            }
          }
        }

        for (const m of Object.keys(insideSince)) {
          if (!stillInside.has(m)) {
            delete insideSince[m];
            changed = true;
          }
        }

        next.push({
          ...rule,
          insideSince,
          notified,
          vesselNames,
          status,
          triggeredAt,
          message,
          lastEmailError,
        });
      }

      if (!cancelled && changed) setRules(next);
    }

    tick();
    const t = setInterval(tick, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiBase, loadArea, ready]);

  const active = useMemo(
    () => rules.filter((r) => r.status === 'watching' || r.status === 'triggered'),
    [rules]
  );
  const triggered = useMemo(() => rules.filter((r) => r.status === 'triggered'), [rules]);

  const finishPolygon = (): AlertPolygon | null => {
    if (draftRing.length < 3) return null;
    const ring = [...draftRing, draftRing[0]];
    return { type: 'Polygon', coordinates: [ring] };
  };

  const addRule = async () => {
    const mmsis = watchAny ? [] : parseMmsiList(mmsiText);
    if (!watchAny && mmsis.length === 0) return;

    let polygon: AlertPolygon | null = null;
    let finalArea: AlertAreaId = areaId;
    if (areaId === 'custom' || drawing) {
      polygon = finishPolygon();
      if (!polygon) return;
      finalArea = 'custom';
    }

    const names: Record<string, string> = {};
    if (draftName && mmsis.length === 1) names[mmsis[0]] = draftName;

    const rule = createAlertRule({
      mmsis,
      vesselNames: names,
      areaId: finalArea,
      polygon,
      dwellMinutes,
      watchHours,
      email: email.trim() || null,
    });
    setRules((prev) => [rule, ...prev]);
    setFormOpen(false);
    onDrawingChange(false);
    onDraftRingChange([]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
    await syncRuleToServer(rule);
  };

  const removeRule = async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await axios.delete(`${apiBase}/api/alerts/${encodeURIComponent(id)}`, { timeout: 8000 });
    } catch {
      /* ignore */
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className={`alerts-fab ${className}`.trim()}
        onClick={onExpand}
        aria-label="Open alerts"
      >
        Alerts{triggered.length ? ` (${triggered.length})` : ''}
      </button>
    );
  }

  return (
    <div className={`alert-panel ${className}`.trim()} role="region" aria-label="Area alerts">
      <div className="alert-panel-header">
        <div className="alert-panel-title">
          Alerts
          {triggered.length > 0 ? <span className="alert-badge">{triggered.length}</span> : null}
        </div>
        <div className="alert-panel-actions">
          <button type="button" className="alert-link" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Cancel' : 'New'}
          </button>
          {onCollapse && (
            <button type="button" className="alert-link" onClick={onCollapse} aria-label="Minimize alerts">
              Minimize
            </button>
          )}
        </div>
      </div>

      {formOpen && (
        <div className="alert-form">
          <label className="alert-check">
            <input
              type="checkbox"
              checked={watchAny}
              onChange={(e) => setWatchAny(e.target.checked)}
            />
            Any ship in the area
          </label>
          {!watchAny && (
            <label>
              MMSIs (comma-separated for many ships)
              <input
                value={mmsiText}
                onChange={(e) => setMmsiText(e.target.value)}
                placeholder="273…, 257…"
              />
            </label>
          )}
          <label>
            Area
            <select
              value={areaId}
              onChange={(e) => {
                const v = e.target.value as AlertAreaId;
                setAreaId(v);
                if (v === 'custom') onDrawingChange(true);
                else onDrawingChange(false);
              }}
            >
              {ALERT_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              <option value="custom">Draw polygon on map…</option>
            </select>
          </label>
          {(areaId === 'custom' || drawing) && (
            <div className="alert-draw-tools">
              <button
                type="button"
                className="alert-primary secondary"
                onClick={() => {
                  setAreaId('custom');
                  onDrawingChange(true);
                }}
              >
                {drawing ? 'Drawing… click map' : 'Start drawing'}
              </button>
              <button
                type="button"
                className="alert-link"
                onClick={() => onDraftRingChange(draftRing.slice(0, -1))}
                disabled={!draftRing.length}
              >
                Undo point
              </button>
              <button
                type="button"
                className="alert-link"
                onClick={() => onDraftRingChange([])}
                disabled={!draftRing.length}
              >
                Clear
              </button>
              <span className="alert-help">
                {draftRing.length} points
                {draftRing.length < 3 ? ' (need ≥3)' : ' — ready'}. Pan is paused while drawing —
                click the map to place corners.
              </span>
            </div>
          )}
          <label>
            Time in area before alert (minutes, 0 = on entry)
            <input
              type="number"
              min={0}
              max={7 * 24 * 60}
              value={dwellMinutes}
              onChange={(e) => setDwellMinutes(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Watch for (hours)
            <input
              type="number"
              min={1}
              max={168}
              value={watchHours}
              onChange={(e) => setWatchHours(Number(e.target.value) || 1)}
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {smtpHint && <p className="alert-help">{smtpHint}</p>}
          <p className="alert-help">
            Browser checks live AIS ~every 20s while this tab is open. With email + SMTP on the
            server, the watch is also registered server-side.
          </p>
          <button type="button" className="alert-primary" onClick={() => addRule()}>
            Start watching
          </button>
        </div>
      )}

      {!formOpen && active.length === 0 && (
        <div className="alert-panel-body">
          Watch specific ships or any traffic in a preset EEZ/FPZ or a drawn AOI. Optional email on
          entry.
        </div>
      )}

      <ul className="alert-list">
        {active.map((r) => (
          <li key={r.id} className={`alert-item status-${r.status}`}>
            <div className="alert-item-main">
              <strong>{ruleWatchSummary(r)}</strong>
              {r.status === 'watching' && Object.keys(r.insideSince).length > 0 && (
                <span className="alert-progress">
                  Inside now: {Object.keys(r.insideSince).join(', ')}
                </span>
              )}
              {r.status === 'watching' && Object.keys(r.insideSince).length === 0 && (
                <span className="alert-progress">Waiting…</span>
              )}
              {r.message && <span className="alert-msg">{r.message}</span>}
              {r.email && <span className="alert-progress">Email: {r.email}</span>}
              {r.lastEmailError && (
                <span className="alert-msg warn">{r.lastEmailError}</span>
              )}
            </div>
            <button type="button" className="alert-link" onClick={() => removeRule(r.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      {rules.some((r) => r.status !== 'watching') && (
        <button
          type="button"
          className="alert-link clear"
          onClick={() => setRules((prev) => prev.filter((r) => r.status === 'watching'))}
        >
          Clear finished
        </button>
      )}
    </div>
  );
}
