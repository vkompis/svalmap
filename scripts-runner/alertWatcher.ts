import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import {
  listServerAlerts,
  loadServerAlerts,
  upsertServerAlert,
  sendAlertEmail,
  type ServerAlertRule,
} from './alertMail';
import { dataSource } from './paths';

type Position = {
  mmsi: string;
  lon: number;
  lat: number;
  vessel_name?: string | null;
};

type FetchPositions = () => Promise<Position[]>;

const areaCache: Record<string, any> = {};

async function loadAreaGeoJSON(rule: ServerAlertRule): Promise<any | null> {
  if (rule.areaId === 'custom' && rule.polygon) {
    return { type: 'Feature', geometry: rule.polygon, properties: {} };
  }
  if (areaCache[rule.areaId]) return areaCache[rule.areaId];
  const fileMap: Record<string, string> = {
    'eez-norway': 'norway-eez.geojson',
    'eez-janmayen': 'janmayen-eez.geojson',
    'eez-svalbard': 'svalbard-fpz.geojson',
  };
  const file = fileMap[rule.areaId];
  if (!file) return null;
  const full = path.join(dataSource('overlays'), file);
  if (!fs.existsSync(full)) return null;
  const gj = JSON.parse(fs.readFileSync(full, 'utf8'));
  areaCache[rule.areaId] = gj;
  return gj;
}

function pointIn(lon: number, lat: number, gj: any): boolean {
  try {
    const pt = turf.point([lon, lat]);
    if (gj.type === 'FeatureCollection') {
      return gj.features.some((f: any) => turf.booleanPointInPolygon(pt, f));
    }
    if (gj.type === 'Feature') return turf.booleanPointInPolygon(pt, gj);
    return turf.booleanPointInPolygon(pt, {
      type: 'Feature',
      geometry: gj,
      properties: {},
    });
  } catch {
    return false;
  }
}

/**
 * Durable area-alert watcher: evaluates disk-persisted rules against live positions
 * without requiring an open browser tab. Email only if SMTP_* is configured.
 */
export function startAlertWatcher(fetchPositions: FetchPositions, intervalMs = 30_000) {
  loadServerAlerts();
  console.log('[alertWatcher] started (file-backed rules)');

  async function tick() {
    const rules = listServerAlerts().filter((r) => r.status === 'watching');
    if (!rules.length) return;
    let positions: Position[] = [];
    try {
      positions = await fetchPositions();
    } catch (e: any) {
      console.warn('[alertWatcher] positions failed', e?.message || e);
      return;
    }
    const now = Date.now();

    for (const rule of rules) {
      const expires = new Date(rule.createdAt).getTime() + rule.watchHours * 3600_000;
      if (now > expires) {
        upsertServerAlert({
          ...rule,
          status: 'expired',
          message: `Watch ended (${rule.watchHours}h)`,
        });
        continue;
      }

      let gj: any;
      try {
        gj = await loadAreaGeoJSON(rule);
      } catch {
        continue;
      }
      if (!gj) continue;

      const candidates =
        rule.mmsis.length === 0
          ? positions
          : positions.filter((v) => {
              const m = String(v.mmsi ?? '').replace(/\D/g, '').padStart(9, '0').slice(-9);
              return rule.mmsis.includes(m);
            });

      const insideSince = { ...(rule.insideSince || {}) };
      const notified = [...(rule.notified || [])];
      const vesselNames = { ...(rule.vesselNames || {}) };
      let status = rule.status;
      let triggeredAt = rule.triggeredAt;
      let message = rule.message;
      let changed = false;
      const stillInside = new Set<string>();

      for (const v of candidates) {
        const mmsi = String(v.mmsi ?? '').replace(/\D/g, '').padStart(9, '0').slice(-9);
        if (!mmsi) continue;
        if (!pointIn(v.lon, v.lat, gj)) continue;
        stillInside.add(mmsi);
        if (v.vessel_name) vesselNames[mmsi] = String(v.vessel_name);
        if (!insideSince[mmsi]) {
          insideSince[mmsi] = new Date().toISOString();
          changed = true;
        }
        const dwellMs = now - new Date(insideSince[mmsi]).getTime();
        if (dwellMs < rule.dwellMinutes * 60_000) continue;
        if (notified.includes(mmsi)) continue;

        notified.push(mmsi);
        status = 'triggered';
        triggeredAt = new Date().toISOString();
        const name = vesselNames[mmsi] || `MMSI ${mmsi}`;
        message = `${name} entered ${rule.areaLabel}${
          rule.dwellMinutes > 0 ? ` (≥${rule.dwellMinutes} min)` : ''
        }`;
        changed = true;

        if (rule.email) {
          const result = await sendAlertEmail({
            to: rule.email,
            subject: `SvalMap alert: ${rule.areaLabel}`,
            text: `${message}\n\nRule: ${rule.id}\nTime: ${new Date().toISOString()}\n`,
          });
          if (!result.ok) {
            console.warn('[alertWatcher] email failed', result.error);
          }
        } else {
          console.log('[alertWatcher]', message);
        }
      }

      for (const m of Object.keys(insideSince)) {
        if (!stillInside.has(m)) {
          delete insideSince[m];
          changed = true;
        }
      }

      if (changed) {
        upsertServerAlert({
          ...rule,
          insideSince,
          notified,
          vesselNames,
          status,
          triggeredAt,
          message,
        });
      }
    }
  }

  tick().catch(() => undefined);
  return setInterval(() => {
    tick().catch(() => undefined);
  }, intervalMs);
}
