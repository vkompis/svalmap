import { BigQuery } from '@google-cloud/bigquery';
import { logger } from '../utils/logger';

export class SanctionsChecker {
  private bigquery: BigQuery;
  private readonly BQ_DATASET: string;

  constructor() {
    this.bigquery = new BigQuery();
    this.BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
  }

  async checkSanctions(): Promise<void> {
    logger.info('Starting sanctions checking process');

    try {
      // Check for vessels in the AOI that match sanctions criteria
      const sanctionsMatches = await this.findSanctionsMatches();
      
      if (sanctionsMatches.length > 0) {
        logger.info(`Found ${sanctionsMatches.length} vessels matching sanctions criteria`);
        
        // Create incidents for sanctions violations
        await this.createSanctionsIncidents(sanctionsMatches);
      } else {
        logger.info('No sanctions violations detected');
      }

      // Update sanctions data if needed (daily)
      await this.updateSanctionsData();

    } catch (error) {
      logger.error('Failed to check sanctions', { error });
      throw error;
    }
  }

  private async findSanctionsMatches(): Promise<any[]> {
    try {
      const query = `
        SELECT DISTINCT
          vp.mmsi,
          vp.vessel_name,
          vp.latitude,
          vp.longitude,
          vp.timestamp,
          s.source as sanctions_source,
          s.reason as sanctions_reason,
          s.country as sanctions_country
        FROM \`${this.BQ_DATASET}.vessel_positions\` vp
        INNER JOIN \`${this.BQ_DATASET}.sanctions_mmsi\` s
        ON vp.mmsi = s.mmsi
        WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        AND vp.latitude BETWEEN 70.0 AND 81.0
        AND vp.longitude BETWEEN 10.0 AND 35.0
      `;

      const [job] = await this.bigquery.query({
        query,
        useLegacySql: false
      });

      if (job.errors && job.errors.length > 0) {
        throw new Error(`BigQuery query failed: ${JSON.stringify(job.errors)}`);
      }

      return job && job[0] ? job[0] : [];

    } catch (error) {
      logger.error('Failed to find sanctions matches', { error });
      throw error;
    }
  }

  private async createSanctionsIncidents(sanctionsMatches: any[]): Promise<void> {
    try {
      const incidents = sanctionsMatches.map(match => ({
        id: `sanctions_${match.mmsi}_${Date.now()}`,
        type: 'SANCTIONS_VIOLATION',
        severity: 'HIGH',
        vessel_mmsi: match.mmsi,
        vessel_name: match.vessel_name,
        latitude: match.latitude,
        longitude: match.longitude,
        timestamp: match.timestamp,
        details: `Vessel matches ${match.sanctions_source} sanctions: ${match.sanctions_reason}`,
        confidence: 0.95,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Insert into incidents table
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('incidents');
      
      const [job] = await table.insert(incidents);
      
      if (job.status.errors) {
        logger.error('Errors during sanctions incidents insert', { errors: job.status.errors });
      } else {
        logger.info(`Successfully created ${incidents.length} sanctions incidents`);
      }

    } catch (error) {
      logger.error('Failed to create sanctions incidents', { error });
      throw error;
    }
  }

  private async updateSanctionsData(): Promise<void> {
    try {
      // Check if we need to update sanctions data (daily)
      const lastUpdate = await this.getLastSanctionsUpdate();
      const now = new Date();
      const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceUpdate >= 24) {
        logger.info('Updating sanctions data (24+ hours since last update)');
        
        // This would trigger the sanctions loader script
        // In production, you might want to use Cloud Scheduler or similar
        logger.info('Sanctions update needed - run npm run load:sanctions');
      } else {
        logger.info(`Sanctions data is current (${hoursSinceUpdate.toFixed(1)} hours since last update)`);
      }

    } catch (error) {
      logger.warn('Failed to check sanctions update status', { error });
    }
  }

  private async getLastSanctionsUpdate(): Promise<Date> {
    try {
      const query = `
        SELECT MAX(updated_at) as last_update
        FROM \`${this.BQ_DATASET}.sanctions_mmsi\`
      `;

      const [job] = await this.bigquery.query({
        query,
        useLegacySql: false
      });

      if (job && job[0] && job[0][0] && job[0][0].last_update) {
        return new Date(job[0][0].last_update);
      }

      // Default to 24 hours ago if no data
      return new Date(Date.now() - 24 * 60 * 60 * 1000);

    } catch (error) {
      logger.warn('Failed to get last sanctions update', { error });
      // Default to 24 hours ago
      return new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
  }
}
