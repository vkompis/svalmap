#!/usr/bin/env ts-node

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

interface AOIPolygon {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    name: string;
    source: string;
    area_km2?: number;
  };
}

interface AOIResult {
  unifiedPolygon: any;
  wkt: string;
  area_km2: number;
  boundingBox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

const DATA_SOURCE_DIR = join(__dirname, '../../../data/source');
const AOI_OUTPUT_DIR = join(__dirname, '../../../data');
const SVALBARD_EEZ_DIR = join(DATA_SOURCE_DIR, 'SvalbardEEZ');

class AOIDeriver {
  private polygons: AOIPolygon[] = [];
  private processedFiles: string[] = [];

  async deriveAOI(): Promise<AOIResult> {
    console.log('🗺️  Starting AOI derivation process...');
    console.log(`📁 Source directory: ${SVALBARD_EEZ_DIR}`);
    console.log(`📁 Output directory: ${AOI_OUTPUT_DIR}`);

    try {
      // Read all Svalbard EEZ files
      await this.readSvalbardEEZFiles();

      if (this.polygons.length === 0) {
        throw new Error('No valid polygons found in Svalbard EEZ directory');
      }

      // Union all polygons into one
      const unifiedPolygon = await this.unionPolygons();

      // Convert to WKT
      const wkt = this.polygonToWKT(unifiedPolygon);

      // Calculate area and bounding box
      const area_km2 = this.calculateArea(unifiedPolygon);
      const boundingBox = this.calculateBoundingBox(unifiedPolygon);

      const result: AOIResult = {
        unifiedPolygon,
        wkt,
        area_km2,
        boundingBox
      };

      // Save results
      await this.saveResults(result);

      // Print WKT to stdout (for use in jobs)
      console.log('\n📋 AOI_WKT for jobs configuration:');
      console.log('=====================================');
      console.log(wkt);

      return result;
    } catch (error) {
      console.error('❌ Error during AOI derivation:', error);
      throw error;
    }
  }

  private async readSvalbardEEZFiles(): Promise<void> {
    console.log('📖 Reading Svalbard EEZ files...');

    if (!existsSync(SVALBARD_EEZ_DIR)) {
      throw new Error(`Svalbard EEZ directory not found: ${SVALBARD_EEZ_DIR}`);
    }

    const files = readdirSync(SVALBARD_EEZ_DIR);
    const shapefiles = files.filter(file => 
      extname(file).toLowerCase() === '.shp' ||
      extname(file).toLowerCase() === '.geojson' ||
      extname(file).toLowerCase() === '.gml'
    );

    console.log(`📁 Found ${shapefiles.length} geographic files`);

    for (const file of shapefiles) {
      try {
        const filePath = join(SVALBARD_EEZ_DIR, file);
        const polygons = await this.readGeographicFile(filePath);
        this.polygons.push(...polygons);
        this.processedFiles.push(file);
        console.log(`✅ Processed ${file}: ${polygons.length} polygons`);
      } catch (error) {
        console.warn(`⚠️  Warning: Could not process ${file}: ${error}`);
      }
    }

    console.log(`📊 Total polygons loaded: ${this.polygons.length}`);
  }

  private async readGeographicFile(filePath: string): Promise<AOIPolygon[]> {
    const ext = extname(filePath).toLowerCase();
    let geojson: any;

    try {
      if (ext === '.shp') {
        geojson = await this.readShapefile(filePath);
      } else if (ext === '.gml') {
        geojson = await this.readGML(filePath);
      } else if (ext === '.geojson') {
        geojson = await this.readGeoJSON(filePath);
      } else {
        throw new Error(`Unsupported file format: ${ext}`);
      }

      // Convert features to AOIPolygon format
      const polygons: AOIPolygon[] = [];
      for (const feature of geojson.features) {
        if (feature.geometry && 
            (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
          
          const polygon: AOIPolygon = {
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
              name: this.extractName(feature.properties) || 'Svalbard EEZ',
              source: 'Norwegian Directorate of Fisheries'
            }
          };

          // Calculate area
          polygon.properties.area_km2 = this.calculateArea(polygon);

          polygons.push(polygon);
        }
      }

      return polygons;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  private async readShapefile(filePath: string): Promise<any> {
    try {
      // Use ogr2ogr to convert shapefile to GeoJSON
      const output = execSync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 - /dev/stdin`, {
        input: readFileSync(filePath),
        encoding: 'utf8'
      });
      
      return JSON.parse(output);
    } catch (error) {
      console.warn(`ogr2ogr failed for ${filePath}, trying alternative method`);
      // Fallback: return empty GeoJSON
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private async readGML(filePath: string): Promise<any> {
    try {
      // Use ogr2ogr to convert GML to GeoJSON
      const output = execSync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 - /dev/stdin`, {
        input: readFileSync(filePath),
        encoding: 'utf8'
      });
      
      return JSON.parse(output);
    } catch (error) {
      console.warn(`ogr2ogr failed for GML file ${filePath}`);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private async readGeoJSON(filePath: string): Promise<any> {
    try {
      const content = readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Error reading GeoJSON file ${filePath}:`, error);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  private extractName(properties: any): string | null {
    const nameFields = ['name', 'NAME', 'Name', 'title', 'TITLE', 'Title'];
    for (const field of nameFields) {
      if (properties && properties[field]) {
        return properties[field];
      }
    }
    return null;
  }

  private async unionPolygons(): Promise<any> {
    console.log('🔗 Unioning polygons...');

    if (this.polygons.length === 1) {
      console.log('📝 Single polygon found, no union needed');
      return this.polygons[0];
    }

    try {
      // Use ogr2ogr to union all polygons
      const inputGeoJSON = {
        type: 'FeatureCollection',
        features: this.polygons
      };

      const inputFile = join(AOI_OUTPUT_DIR, 'temp_input.geojson');
      writeFileSync(inputFile, JSON.stringify(inputGeoJSON, null, 2));

      // Use ogr2ogr to union polygons
      const output = execSync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 -sql "SELECT ST_Union(geometry) as geometry FROM temp_input" ${inputFile}`, {
        encoding: 'utf8'
      });

      // Clean up temp file
      try {
        execSync(`rm ${inputFile}`);
      } catch (e) {
        // Ignore cleanup errors
      }

      const result = JSON.parse(output);
      
      if (result.features && result.features.length > 0) {
        console.log('✅ Polygons successfully unioned');
        return result.features[0];
      } else {
        throw new Error('Union operation failed to produce valid result');
      }
    } catch (error) {
      console.warn(`ogr2ogr union failed, using first polygon as fallback: ${error}`);
      return this.polygons[0];
    }
  }

  private polygonToWKT(polygon: any): string {
    try {
      const geometry = polygon.geometry;
      
      if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates.map((ring: number[][]) => 
          `(${ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ')})`
        ).join(', ');
        return `POLYGON(${rings})`;
      } else if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates.map((polygon: number[][][]) => 
          `(${polygon.map(ring => 
            `(${ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ')})`
          ).join(', ')})`
        ).join(', ');
        return `MULTIPOLYGON(${polygons})`;
      } else {
        throw new Error(`Unsupported geometry type: ${geometry.type}`);
      }
    } catch (error) {
      console.error('Error converting polygon to WKT:', error);
      throw error;
    }
  }

  private calculateArea(polygon: any): number {
    try {
      // Calculate area using a simple approximation
      // In production, you'd want to use a proper geodesic area calculation
      const geometry = polygon.geometry;
      let totalArea = 0;

      if (geometry.type === 'Polygon') {
        totalArea = this.calculatePolygonArea(geometry.coordinates[0]);
      } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
          totalArea += this.calculatePolygonArea(poly[0]);
        }
      }

      // Convert to square kilometers (approximate)
      // 1 degree² ≈ 111.32 km² at the equator
      return totalArea * 111.32;
    } catch (error) {
      console.warn('Error calculating area:', error);
      return 0;
    }
  }

  private calculatePolygonArea(coordinates: number[][]): number {
    // Shoelace formula for polygon area
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += coordinates[i][0] * coordinates[j][1];
      area -= coordinates[j][0] * coordinates[i][1];
    }
    
    return Math.abs(area) / 2;
  }

  private calculateBoundingBox(polygon: any): { north: number; south: number; east: number; west: number } {
    try {
      const geometry = polygon.geometry;
      let allCoords: number[][] = [];

      if (geometry.type === 'Polygon') {
        allCoords = geometry.coordinates.flat();
      } else if (geometry.type === 'MultiPolygon') {
        allCoords = geometry.coordinates.flat(2);
      }

      if (allCoords.length === 0) {
        throw new Error('No coordinates found');
      }

      const lats = allCoords.map(coord => coord[1]);
      const lons = allCoords.map(coord => coord[0]);

      return {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lons),
        west: Math.min(...lons)
      };
    } catch (error) {
      console.error('Error calculating bounding box:', error);
      return { north: 0, south: 0, east: 0, west: 0 };
    }
  }

  private async saveResults(result: AOIResult): Promise<void> {
    console.log('💾 Saving AOI results...');

    // Ensure output directory exists
    if (!existsSync(AOI_OUTPUT_DIR)) {
      execSync(`mkdir -p ${AOI_OUTPUT_DIR}`);
    }

    // Save as GeoJSON
    const geojsonPath = join(AOI_OUTPUT_DIR, 'aoi.geojson');
    const geojsonOutput = {
      type: 'Feature',
      properties: {
        name: 'SvalMap Area of Interest',
        description: 'Unified Svalbard EEZ boundary for maritime monitoring',
        source: 'Norwegian Directorate of Fisheries',
        area_km2: result.area_km2,
        bounding_box: result.boundingBox,
        created_at: new Date().toISOString()
      },
      geometry: result.unifiedPolygon.geometry
    };

    writeFileSync(geojsonPath, JSON.stringify(geojsonOutput, null, 2));
    console.log(`✅ GeoJSON saved to: ${geojsonPath}`);

    // Save as WKT
    const wktPath = join(AOI_OUTPUT_DIR, 'aoi.wkt');
    writeFileSync(wktPath, result.wkt);
    console.log(`✅ WKT saved to: ${wktPath}`);

    // Print summary
    console.log('\n📊 AOI Summary');
    console.log('==============');
    console.log(`📍 Area: ${result.area_km2.toFixed(2)} km²`);
    console.log(`🗺️  Bounding Box:`);
    console.log(`   North: ${result.boundingBox.north.toFixed(6)}°`);
    console.log(`   South: ${result.boundingBox.south.toFixed(6)}°`);
    console.log(`   East: ${result.boundingBox.east.toFixed(6)}°`);
    console.log(`   West: ${result.boundingBox.west.toFixed(6)}°`);
    console.log(`📁 Files processed: ${this.processedFiles.length}`);
    console.log(`📋 Output files:`);
    console.log(`   - ${geojsonPath}`);
    console.log(`   - ${wktPath}`);
  }
}

// Main execution
async function main() {
  try {
    const deriver = new AOIDeriver();
    const result = await deriver.deriveAOI();
    console.log('\n🎉 AOI derivation completed successfully!');
  } catch (error) {
    console.error('\n💥 AOI derivation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { AOIDeriver };
