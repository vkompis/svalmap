import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const router = Router();

// Absolute base paths provided by the user
const AOI_BASE_PATH = '/Users/vegardhalkjelsvik/Dev/svalmap/data/source/Proximity markers/AOI';
const PROXIMITY_BASE_PATH = '/Users/vegardhalkjelsvik/Dev/svalmap/data/source/Proximity markers';

function readGeoJSON(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`GeoJSON not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// GET /api/v1/areas/aoi?name=Svalbard|JanMayen|Norway
router.get('/aoi', (req, res) => {
  try {
    const name = String(req.query.name || 'Svalbard');
    const filename = `${name.replace(/\s+/g, '')}.geojson`;
    const filePath = path.join(AOI_BASE_PATH, filename);
    const data = readGeoJSON(filePath);
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(404).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /api/v1/areas/infrastructure?type=petroleum|pipelines|cables
router.get('/infrastructure', (req, res) => {
  try {
    const type = String(req.query.type || 'petroleum');
    const map: Record<string, string> = {
      petroleum: 'Petroleuminstallations.geojson',
      pipelines: 'Pipelines.geojson',
      cables: 'Underseacables.geojson',
    };
    const filename = map[type.toLowerCase()];
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Invalid type', timestamp: new Date().toISOString() });
    }
    const filePath = path.join(PROXIMITY_BASE_PATH, filename);
    const data = readGeoJSON(filePath);
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(404).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

export default router;


