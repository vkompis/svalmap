import path from 'path';
import fs from 'fs';

/** Repo root (parent of scripts-runner/). Override with SVALMAP_ROOT. */
export function repoRoot(): string {
  if (process.env.SVALMAP_ROOT) return path.resolve(process.env.SVALMAP_ROOT);
  return path.resolve(__dirname, '..');
}

export function dataSource(...parts: string[]): string {
  return path.join(repoRoot(), 'data', 'source', ...parts);
}

export function dataCache(...parts: string[]): string {
  return path.join(repoRoot(), 'data', 'cache', ...parts);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
