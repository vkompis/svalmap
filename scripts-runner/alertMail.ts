import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { dataCache, ensureDir } from './paths';

export type ServerAlertRule = {
  id: string;
  mmsis: string[];
  vesselNames?: Record<string, string>;
  areaId: string;
  areaLabel: string;
  polygon: { type: 'Polygon'; coordinates: number[][][] } | null;
  dwellMinutes: number;
  watchHours: number;
  email: string | null;
  createdAt: string;
  insideSince?: Record<string, string>;
  notified?: string[];
  status: 'watching' | 'triggered' | 'expired';
  triggeredAt?: string | null;
  message?: string | null;
};

const ALERTS_FILE = () => path.join(dataCache(), 'area-alerts.json');

let rules: ServerAlertRule[] = [];

export function emailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      (process.env.ALERT_FROM || process.env.SMTP_FROM)
  );
}

export function loadServerAlerts(): ServerAlertRule[] {
  try {
    ensureDir(dataCache());
    const file = ALERTS_FILE();
    if (!fs.existsSync(file)) {
      rules = [];
      return rules;
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    rules = Array.isArray(raw) ? raw : [];
    return rules;
  } catch {
    rules = [];
    return rules;
  }
}

export function saveServerAlerts(next: ServerAlertRule[]) {
  rules = next;
  ensureDir(dataCache());
  fs.writeFileSync(ALERTS_FILE(), JSON.stringify(rules, null, 2));
}

export function listServerAlerts() {
  if (!rules.length) loadServerAlerts();
  return rules;
}

export function upsertServerAlert(rule: ServerAlertRule) {
  loadServerAlerts();
  const i = rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) rules[i] = { ...rules[i], ...rule };
  else rules.unshift(rule);
  saveServerAlerts(rules);
  return rule;
}

export function deleteServerAlert(id: string) {
  loadServerAlerts();
  rules = rules.filter((r) => r.id !== id);
  saveServerAlerts(rules);
}

export async function sendAlertEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured()) {
    return {
      ok: false,
      error:
        'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM on scripts-runner.',
    };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.ALERT_FROM || process.env.SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
