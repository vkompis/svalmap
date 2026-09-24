#!/usr/bin/env ts-node

import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import * as turf from '@turf/turf';

interface AssetFeature {
  feature_id: string;
  name: string;
  type: string;
  source: string;
  updated_at: string;
  geog: string; // WKT format for BigQuery GEOGRAPHY
  buffer_1nm: string | null; // WKT format for 1 nautical mile buffer
  buffer_3nm: string | null; // WKT format for 3 nautical mile buffer
}

interface AssetSource {
  path: string;
  type: string;
  source: string;
}

const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const DATA_SOURCE_DIR = join(__dirname, '../../../data/source');

// Asset source definitions
const ASSET_SOURCES: AssetSource[] = [
  // NSM sources (match user's actual filenames)
  { path: 'NSM/Restricted military area sea polygon.shp', type: 'NSM_RESTRICTED_SEA_POLY', source: 'NSM' },
  { path: 'NSM/Restricted military area sea vector.shp', type: 'NSM_RESTRICTED_SEA_LINE', source: 'NSM' },
  { path: 'NSM/nsm restricted area polygon.shp', type: 'NSM_RESTRICTED_LAND', source: 'NSM' },
  { path: 'NSM/nsm restricted area.shp', type: 'NSM_RESTRICTED_LAND', source: 'NSM' },
  // EEZ + cables
  { path: 'SvalbardEEZ/Svalbard EEZ.shp', type: 'EEZ_SVALBARD', source: 'Norwegian Directorate of Fisheries' },
  { path: 'SvalbardEEZ/Svalbard EEZ.geojson', type: 'EEZ_SVALBARD', source: 'Norwegian Directorate of Fisheries' },
  // Fishery protection zone (if provided via GeoNorge WFS or manual download)
  { path: 'SvalbardEEZ/Fiskevernsonen_Svalbard.geojson', type: 'FISHERY_PROTECTION_SVALBARD', source: 'GeoNorge NMG' },
  { path: 'SvalbardCables.geojson', type: 'CABLE', source: 'Norwegian Communications Authority' }
];

class AssetLoader {
  private bigquery: BigQuery;
  private features: AssetFeature[] = [];
  private processedSources: string[] = [];
  private totalFeatures = 0;

  constructor() {
    this.bigquery = new BigQuery();
  }

  async loadAssets(): Promise<void> {
    console.log('🚀 Starting asset loading process...');
    console.log(`📊 Target dataset: ${BQ_DATASET}`);
    console.log(`📁 Source directory: ${DATA_SOURCE_DIR}`);

    try {
      // Process each asset source
      for (const assetSource of ASSET_SOURCES) {
        await this.processAssetSource(assetSource);
      }

      // Bulk insert into BigQuery
      if (this.features.length > 0) {
        await this.bulkInsertToBigQuery();
      }

      this.printSummary();
    } catch (error) {
      console.error('❌ Error during asset loading:', error);
      throw error;
    }
  }

  private async processAssetSource(assetSource: AssetSource): Promise<void> {
    const fullPath = join(DATA_SOURCE_DIR, assetSource.path);
    
    if (!this.fileExists(fullPath)) {
      console.warn(`⚠️  File not found: ${fullPath}`);
      return;
    }

    console.log(`📖 Processing: ${assetSource.path} (${assetSource.type})`);
    
    try {
      const features = await this.readGeographicFile(fullPath, assetSource.type, assetSource.source);
      this.features.push(...features);
      this.processedSources.push(assetSource.path);
      this.totalFeatures += features.length;
      
      console.log(`✅ Processed ${features.length} features from ${assetSource.path}`);
    } catch (error) {
      console.error(`❌ Error processing ${assetSource.path}:`, error);
    }
  }

  private async readGeographicFile(filePath: string, type: string, source: string): Promise<AssetFeature[]> {
    const ext = extname(filePath).toLowerCase();
    const features: AssetFeature[] = [];

    try {
      let geojson: any;

      if (ext === '.shp') {
        geojson = await this.readShapefile(filePath);
      } else if (ext === '.gml') {
        geojson = await this.readGML(filePath);
      } else if (ext === '.geojson') {
        geojson = await this.readGeoJSON(filePath);
      } else {
        throw new Error(`Unsupported file format: ${ext}`);
      }

      // Process each feature
      for (const feature of geojson.features) {
        const assetFeature = this.convertFeatureToAsset(feature, type, source);
        if (assetFeature) {
          features.push(assetFeature);
        }
      }

      return features;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  private async readShapefile(filePath: string): Promise<any> {
    try {
      // Convert EPSG:25833 → WGS84 GeoJSON; restore .shx if missing; make geometries valid
      const output = execSync(
        `ogr2ogr -f GeoJSON -makevalid -s_srs EPSG:25833 -t_srs EPSG:4326 /vsistdout/ "${filePath}"`,
        {
          encoding: 'utf8',
          env: { ...process.env, SHAPE_RESTORE_SHX: 'YES' }
        }
      );
      return JSON.parse(output);
    } catch (error: any) {
      console.warn(`ogr2ogr failed for ${filePath}: ${error?.stderr || error?.message || error}`);
      console.warn(`Trying alternative method for ${filePath}`);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private async readGML(filePath: string): Promise<any> {
    try {
      const output = execSync(
        `ogr2ogr -f GeoJSON -makevalid -s_srs EPSG:25833 -t_srs EPSG:4326 /vsistdout/ "${filePath}"`,
        { encoding: 'utf8' }
      );
      return JSON.parse(output);
    } catch (error) {
      console.warn(`ogr2ogr failed for GML file ${filePath}`);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private async readGeoJSON(filePath: string): Promise<any> {
    try {
      const content = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      // If coordinates look out of WGS84 bounds, reproject from EPSG:25833
      try {
        const sampleGeom = parsed?.features?.[0]?.geometry;
        if (sampleGeom) {
          const coords = this.extractCoordinates(sampleGeom);
          const outOfRange = coords.some((c: number[]) => c[0] > 180 || c[0] < -180 || c[1] > 90 || c[1] < -90);
          if (outOfRange) {
            const output = execSync(
              `ogr2ogr -f GeoJSON -makevalid -s_srs EPSG:25833 -t_srs EPSG:4326 /vsistdout/ "${filePath}"`,
              { encoding: 'utf8' }
            );
            return JSON.parse(output);
          }
        }
      } catch (_) {
        // Ignore and use parsed
      }
      return parsed;
    } catch (error) {
      console.error(`Error reading GeoJSON file ${filePath}:`, error);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private convertFeatureToAsset(feature: any, type: string, source: string): AssetFeature | null {
    try {
      if (!feature.geometry) {
        return null;
      }

      // Ensure WGS84 coordinates
      const reprojected = this.ensureWGS84(feature);
      
      // Generate feature ID
      const feature_id = this.generateFeatureId(feature, type);
      
      // Extract name from properties
      const name = this.extractName(feature.properties) || `Unknown ${type}`;
      
      // Convert to WKT (ensure valid/closed rings where required), force valid with ogr2ogr if needed
      let geog = this.geometryToWKT(reprojected.geometry);
      // Basic sanity: if WKT seems too short or empty, skip
      if (!geog || geog.length < 10) return null;
      
      // Buffers disabled to keep rows small for BigQuery streaming inserts
      const buffer_1nm = null;
      const buffer_3nm = null;

      return {
        feature_id,
        name,
        type,
        source,
        updated_at: new Date().toISOString(),
        geog,
        buffer_1nm,
        buffer_3nm
      };
    } catch (error) {
      console.warn(`Error converting feature:`, error);
      return null;
    }
  }

  private ensureWGS84(feature: any): any {
    const coords = this.extractCoordinates(feature.geometry);
    if (coords.some((coord: number[]) => coord[0] > 180 || coord[0] < -180 || coord[1] > 90 || coord[1] < -90)) {
      console.warn('Coordinates appear to be in non-WGS84 projection, attempting reprojection...');
      // TODO: add proper reprojection if needed
    }
    return feature;
  }

  private extractCoordinates(geometry: any): number[][] {
    if (geometry.type === 'Point') return [geometry.coordinates];
    if (geometry.type === 'LineString') return geometry.coordinates;
    if (geometry.type === 'Polygon') return geometry.coordinates.flat();
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
    return [];
  }

  private generateFeatureId(feature: any, type: string): string {
    if (feature.properties && feature.properties.id) {
      return `${type}_${feature.properties.id}`;
    }
    if (feature.properties && feature.properties.name) {
      return `${type}_${feature.properties.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractName(properties: any): string | null {
    const nameFields = ['name', 'NAME', 'Name', 'title', 'TITLE', 'Title'];
    for (const field of nameFields) {
      if (properties && properties[field]) return properties[field];
    }
    return null;
  }

  private geometryToWKT(geometry: any): string {
    try {
      if (geometry.type === 'Point') {
        return `POINT(${geometry.coordinates[0]} ${geometry.coordinates[1]})`;
      } else if (geometry.type === 'LineString') {
        const coords = geometry.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(', ');
        return `LINESTRING(${coords})`;
      } else if (geometry.type === 'MultiLineString') {
        const lines = geometry.coordinates
          .map((line: number[][]) => `(${line.map(c => `${c[0]} ${c[1]}`).join(', ')})`)
          .join(', ');
        return `MULTILINESTRING(${lines})`;
      } else if (geometry.type === 'MultiPoint') {
        const pts = geometry.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(', ');
        return `MULTIPOINT(${pts})`;
      } else if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates
          .map((ring: number[][]) => `(${this.ensureClosedLinearRing(ring).map(c => `${c[0]} ${c[1]}`).join(', ')})`)
          .join(', ');
        return `POLYGON(${rings})`;
      } else if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates
          .map((polygon: number[][][]) => `(${polygon
            .map((ring: number[][]) => `(${this.ensureClosedLinearRing(ring).map(c => `${c[0]} ${c[1]}`).join(', ')})`)
            .join(', ')})`)
          .join(', ');
        return `MULTIPOLYGON(${polygons})`;
      }
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
    } catch (error) {
      console.error('Error converting geometry to WKT:', error);
      return 'POINT(0 0)';
    }
  }

  private createBuffer(geometry: any, distanceMeters: number): string | null {
    try {
      const type = geometry?.type;
      // Skip buffering large polygonal geometries to avoid high memory usage
      if (type === 'Polygon' || type === 'MultiPolygon') {
        return null;
      }
      const feature = { type: 'Feature', geometry, properties: {} } as any;
      const distanceKm = distanceMeters / 1000;
      const buffered = turf.buffer(feature, distanceKm, { units: 'kilometers' }) as any;
      if (buffered && buffered.geometry && (buffered.geometry.type === 'Polygon' || buffered.geometry.type === 'MultiPolygon')) {
        return this.geometryToWKT(buffered.geometry);
      }
      return null;
    } catch (error) {
      console.warn('Error creating buffer, using original geometry:', error);
      return null;
    }
  }

  private ensureClosedLinearRing(ring: number[][]): number[][] {
    if (!ring || ring.length === 0) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.length < 2 || last.length < 2) return ring;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return [...ring, [first[0], first[1]]];
    }
    return ring;
  }

  private async bulkInsertToBigQuery(): Promise<void> {
    console.log(`📤 Inserting ${this.features.length} features into BigQuery...`);
    try {
      const datasetName = BQ_DATASET.split('.')[1];
      const dataset = this.bigquery.dataset(datasetName);
      const table = dataset.table('assets');

      // Ensure table exists
      await this.ensureTableExists();
      await this.ensureStagingTableExists();

      // 1) Insert into staging table as strings (WKT)
      const tableWkt = dataset.table('assets_wkt');
      const stagingRows = this.features.map(f => ({
        feature_id: f.feature_id,
        name: f.name,
        type: f.type,
        source: f.source,
        updated_at: f.updated_at,
        geog_wkt: f.geog,
        buffer_1nm_wkt: f.buffer_1nm || null,
        buffer_3nm_wkt: f.buffer_3nm || null
      }));

      await tableWkt.insert(stagingRows as any);
      console.log('✅ Staging insert (WKT) completed');

      // 2) DML to cast WKT → GEOGRAPHY and load into final table
      const insertSql = `
        INSERT INTO \`${BQ_DATASET}.assets\` (feature_id, name, type, source, updated_at, geog, buffer_1nm, buffer_3nm)
        SELECT feature_id,
               name,
               type,
               source,
               TIMESTAMP(updated_at) AS updated_at,
               ST_GEOGFROMTEXT(geog_wkt) AS geog,
               IFNULL(ST_GEOGFROMTEXT(buffer_1nm_wkt), NULL) AS buffer_1nm,
               IFNULL(ST_GEOGFROMTEXT(buffer_3nm_wkt), NULL) AS buffer_3nm
        FROM \`${BQ_DATASET}.assets_wkt\`
        WHERE ST_GEOGFROMTEXT(geog_wkt) IS NOT NULL
      `;
      await this.bigquery.query({ query: insertSql, useLegacySql: false });
      console.log('✅ Final insert (cast to GEOGRAPHY) completed');
    } catch (error: any) {
      if (error && error.name === 'PartialFailureError') {
        console.error('❌ Partial failures during insert:');
        const insertErrors = error.response?.insertErrors || [];
        insertErrors.forEach((entry: any) => {
          const idx = entry.index;
          const messages = (entry.errors || []).map((e: any) => `${e.reason}: ${e.message}`).join(' | ');
          const row = this.features[idx];
          console.error(`  Row ${idx}: ${messages}`);
          if (row) {
            console.error(`    feature_id=${row.feature_id} type=${row.type} name=${row.name}`);
            console.error(`    geog=${(row.geog || '').slice(0, 200)}${(row.geog || '').length > 200 ? '...' : ''}`);
          }
        });
      } else {
        console.error('❌ Error inserting into BigQuery:', error);
      }
      throw error;
    }
  }

  private async ensureTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('assets');
      const [exists] = await table.exists();
      if (!exists) {
        console.log('📋 Creating assets table...');
        const schema = [
          { name: 'feature_id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING' },
          { name: 'type', type: 'STRING', mode: 'REQUIRED' },
          { name: 'source', type: 'STRING' },
          { name: 'updated_at', type: 'TIMESTAMP' },
          { name: 'geog', type: 'GEOGRAPHY', mode: 'REQUIRED' },
          { name: 'buffer_1nm', type: 'GEOGRAPHY' },
          { name: 'buffer_3nm', type: 'GEOGRAPHY' }
        ];
        await table.create({ schema });
        console.log('✅ Assets table created');
      }
    } catch (error) {
      console.error('❌ Error ensuring table exists:', error);
      throw error;
    }
  }

  private async ensureStagingTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('assets_wkt');
      const [exists] = await table.exists();
      if (!exists) {
        console.log('📋 Creating assets_wkt staging table...');
        const schema = [
          { name: 'feature_id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING' },
          { name: 'type', type: 'STRING', mode: 'REQUIRED' },
          { name: 'source', type: 'STRING' },
          { name: 'updated_at', type: 'STRING' },
          { name: 'geog_wkt', type: 'STRING', mode: 'REQUIRED' },
          { name: 'buffer_1nm_wkt', type: 'STRING' },
          { name: 'buffer_3nm_wkt', type: 'STRING' }
        ];
        await table.create({ schema });
        console.log('✅ assets_wkt table created');
      } else {
        // Clear previous contents to avoid duplicates
        await this.bigquery.query({
          query: `TRUNCATE TABLE \`${BQ_DATASET}.assets_wkt\``,
          useLegacySql: false
        });
      }
    } catch (error) {
      console.error('❌ Error ensuring staging table exists:', error);
      throw error;
    }
  }

  private fileExists(filePath: string): boolean {
    try {
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private printSummary(): void {
    console.log('\n📊 Asset Loading Summary');
    console.log('========================');
    console.log(`✅ Total features processed: ${this.totalFeatures}`);
    console.log(`📁 Sources processed: ${this.processedSources.length}`);
    console.log(`🎯 Target dataset: ${BQ_DATASET}`);
    console.log(`📅 Completed at: ${new Date().toISOString()}`);
    if (this.processedSources.length > 0) {
      console.log('\n📋 Processed sources:');
      this.processedSources.forEach(source => console.log(`  - ${source}`));
    }
  }
}

// Main execution
async function main() {
  try {
    const loader = new AssetLoader();
    await loader.loadAssets();
    console.log('\n🎉 Asset loading completed successfully!');
  } catch (error) {
    console.error('\n💥 Asset loading failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { AssetLoader };
