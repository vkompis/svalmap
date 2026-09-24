import { Router } from 'express';
import axios from 'axios';

const router = Router();

// Simple in-memory cache
const cache: Record<string, { ts: number; data: any }> = {};
const withCache = async (key: string, ttlMs: number, fetcher: () => Promise<any>) => {
  const now = Date.now();
  const hit = cache[key];
  if (hit && now - hit.ts < ttlMs) return hit.data;
  const data = await fetcher();
  cache[key] = { ts: now, data };
  return data;
};

// GET /api/v1/overlays/navwarnings
router.get('/navwarnings', async (req, res) => {
  try {
    const data = await withCache('nav-xix', 15 * 60 * 1000, async () => {
      const { data } = await axios.get('https://api.kystverket.no/api/navigationwarnings/navareaxix', { timeout: 20000 });
      return data;
    });
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /api/v1/overlays/ice?type=edge|chart
router.get('/ice', async (req, res) => {
  try {
    const type = String(req.query.type || 'edge');
    const key = `ice-${type}`;
    const url = type === 'chart'
      ? 'https://www.barentswatch.no/api/v1/geodata/download/icechart/?format=OLEX'
      : 'https://www.barentswatch.no/api/v1/geodata/download/iceedge/?format=OLEX';
    const data = await withCache(key, 60 * 60 * 1000, async () => {
      const { data } = await axios.get(url, { timeout: 30000 });
      return data;
    });
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

export default router;


