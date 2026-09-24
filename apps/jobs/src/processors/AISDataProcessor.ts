import { BigQuery } from '@google-cloud/bigquery';
import axios from 'axios';
import { config } from '@svalmap/config';
import { logger } from '../utils/logger';
import { VesselPosition } from '@svalmap/types';

interface BarentsWatchAISData {
  mmsi: number;
  timestamp: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  heading: number;
  status: number;
  vessel_name?: string;
  call_sign?: string;
  imo?: string;
  vessel_type?: number;
  length?: number;
  width?: number;
  draft?: number;
}

interface BarentsWatchResponse {
  data: BarentsWatchAISData[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export class AISDataProcessor {
  private bigquery: BigQuery;
  private readonly BQ_DATASET: string;
  private readonly AOI_WKT: string;

  constructor() {
    this.bigquery = new BigQuery();
    this.BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
    this.AOI_WKT = process.env.AOI_WKT || '';
  }

  async processVesselPositions(): Promise<void> {
    logger.info('Starting AIS data processing from BarentsWatch');

    try {
      // Fetch AIS data from BarentsWatch (last 10 minutes)
      const aisData = await this.fetchBarentsWatchData();
      
      if (!aisData || aisData.length === 0) {
        logger.info('No AIS data received from BarentsWatch');
        return;
      }

      logger.info(`Received ${aisData.length} AIS records from BarentsWatch`);

      // Filter data to AOI
      const filteredData = this.filterToAOI(aisData);
      
      if (filteredData.length === 0) {
        logger.info('No AIS data within Area of Interest');
        return;
      }

      logger.info(`Filtered to ${filteredData.length} records within AOI`);

      // Convert to BigQuery format
      const positions = this.convertToPositions(filteredData);

      // Insert into BigQuery
      await this.insertIntoBigQuery(positions);

      logger.info(`Successfully processed ${positions.length} vessel positions`);
    } catch (error) {
      logger.error('Failed to process AIS data', { error });
      throw error;
    }
  }

  private async fetchBarentsWatchData(): Promise<BarentsWatchAISData[]> {
    try {
      // Get BarentsWatch API token from Secret Manager or environment
      const apiToken = await this.getBarentsWatchToken();
      
      if (!apiToken) {
        throw new Error('BarentsWatch API token not available');
      }

      // Calculate time range (last 10 minutes)
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 10 * 60 * 1000); // 10 minutes ago

      // Fetch data from BarentsWatch API
      const response = await axios.get<BarentsWatchResponse>(
        'https://api.barentswatch.no/vessel/v1/ais',
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'User-Agent': 'SvalMap-AIS-Processor/1.0'
          },
          params: {
            from: startTime.toISOString(),
            to: endTime.toISOString(),
            per_page: 1000, // Adjust based on API limits
            page: 1
          },
          timeout: 30000
        }
      );

      if (response.status !== 200) {
        throw new Error(`BarentsWatch API returned status ${response.status}`);
      }

      logger.info(`Fetched ${response.data.data.length} AIS records from BarentsWatch`);
      return response.data.data;

    } catch (error) {
      logger.error('Failed to fetch BarentsWatch data', { error });
      throw error;
    }
  }

  private async getBarentsWatchToken(): Promise<string | null> {
    // Try environment variable first
    if (process.env.BARENTSWATCH_API_TOKEN) {
      return process.env.BARENTSWATCH_API_TOKEN;
    }

    // Try Secret Manager (GCP)
    try {
      const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
      const client = new SecretManagerServiceClient();
      
      const name = 'projects/svalmap/secrets/barentswatch-api-token/versions/latest';
      const [version] = await client.accessSecretVersion({ name });
      
      return version.payload.data.toString();
    } catch (error) {
      logger.warn('Could not retrieve token from Secret Manager', { error });
      return null;
    }
  }

  private filterToAOI(aisData: BarentsWatchAISData[]): BarentsWatchAISData[] {
    if (!this.AOI_WKT) {
      logger.warn('AOI_WKT not configured, accepting all data');
      return aisData;
    }

    // Simple bounding box filter as fallback
    // In production, use proper spatial queries with BigQuery GIS
    const aoiBounds = this.parseAOIBounds();
    
    return aisData.filter(record => {
      return record.latitude >= aoiBounds.south &&
             record.latitude <= aoiBounds.north &&
             record.longitude >= aoiBounds.west &&
             record.longitude <= aoiBounds.east;
    });
  }

  private parseAOIBounds(): { north: number; south: number; east: number; west: number } {
    // Parse WKT to get bounding box
    // This is a simplified parser - in production use a proper WKT library
    try {
      // Extract coordinates from WKT POLYGON or MULTIPOLYGON
      const coordMatch = this.AOI_WKT.match(/\(\(([^)]+)\)\)/);
      if (coordMatch) {
        const coords = coordMatch[1].split(',').map(pair => {
          const [lon, lat] = pair.trim().split(' ').map(Number);
          return { lon, lat };
        });

        const lats = coords.map(c => c.lat);
        const lons = coords.map(c => c.lon);

        return {
          north: Math.max(...lats),
          south: Math.min(...lats),
          east: Math.max(...lons),
          west: Math.min(...lons)
        };
      }
    } catch (error) {
      logger.warn('Failed to parse AOI WKT, using default bounds', { error });
    }

    // Default bounds for Svalbard EEZ + Barents Sea
    return {
      north: 81.0,
      south: 70.0,
      east: 35.0,
      west: 10.0
    };
  }

  private convertToPositions(aisData: BarentsWatchAISData[]): VesselPosition[] {
    return aisData.map(record => ({
      mmsi: record.mmsi,
      timestamp: new Date(record.timestamp).toISOString(),
      latitude: record.latitude,
      longitude: record.longitude,
      speed: record.speed,
      course: record.course,
      heading: record.heading,
      navigation_status: record.status,
      vessel_name: record.vessel_name || null,
      call_sign: record.call_sign || null,
      imo: record.imo || null,
      vessel_type: record.vessel_type || null,
      length: record.length || null,
      width: record.width || null,
      draft: record.draft || null,
      source: 'BarentsWatch',
      created_at: new Date().toISOString()
    }));
  }

  private async insertIntoBigQuery(positions: VesselPosition[]): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('vessel_positions');
      
      // Ensure table exists
      await this.ensureTableExists();
      
      // Insert data
      const [job] = await table.insert(positions);
      
      if (job.status.errors) {
        logger.error('Errors during BigQuery insert', { errors: job.status.errors });
        throw new Error('BigQuery insert failed');
      }

      logger.info(`Successfully inserted ${positions.length} positions into BigQuery`);
    } catch (error) {
      logger.error('Failed to insert into BigQuery', { error });
      throw error;
    }
  }

  private async ensureTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('vessel_positions');
      
      const [exists] = await table.exists();
      if (!exists) {
        logger.info('Creating vessel_positions table...');
        
        const schema = [
          { name: 'mmsi', type: 'INT64', mode: 'REQUIRED' },
          { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
          { name: 'latitude', type: 'FLOAT64', mode: 'REQUIRED' },
          { name: 'longitude', type: 'FLOAT64', mode: 'REQUIRED' },
          { name: 'speed', type: 'FLOAT64' },
          { name: 'course', type: 'FLOAT64' },
          { name: 'heading', type: 'FLOAT64' },
          { name: 'navigation_status', type: 'INT64' },
          { name: 'vessel_name', type: 'STRING' },
          { name: 'call_sign', type: 'STRING' },
          { name: 'imo', type: 'STRING' },
          { name: 'vessel_type', type: 'INT64' },
          { name: 'length', type: 'FLOAT64' },
          { name: 'width', type: 'FLOAT64' },
          { name: 'draft', type: 'FLOAT64' },
          { name: 'source', type: 'STRING' },
          { name: 'created_at', type: 'TIMESTAMP' }
        ];
        
        await table.create({ 
          schema,
          timePartitioning: {
            type: 'DAY',
            field: 'timestamp'
          },
          clustering: ['mmsi', 'timestamp']
        });
        
        logger.info('vessel_positions table created successfully');
      }
    } catch (error) {
      logger.error('Failed to ensure table exists', { error });
      throw error;
    }
  }
}
