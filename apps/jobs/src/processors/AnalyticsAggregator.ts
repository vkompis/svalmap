import { BigQuery } from '@google-cloud/bigquery';
import { logger } from '../utils/logger';

interface DailyAnalytics {
  date: string;
  total_vessels: number;
  total_positions: number;
  total_incidents: number;
  incidents_by_type: Record<string, number>;
  incidents_by_severity: Record<string, number>;
  top_vessels_by_incidents: Array<{ mmsi: number; vessel_name: string; incident_count: number }>;
  average_vessel_speed: number;
  restricted_zone_violations: number;
  created_at: string;
}

export class AnalyticsAggregator {
  private bigquery: BigQuery;
  private readonly BQ_DATASET: string;

  constructor() {
    this.bigquery = new BigQuery();
    this.BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
  }

  async aggregateDaily(): Promise<void> {
    logger.info('Starting daily analytics aggregation');

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      // Check if analytics already exist for this date
      const existingAnalytics = await this.checkExistingAnalytics(dateStr);
      if (existingAnalytics) {
        logger.info(`Analytics already exist for ${dateStr}, skipping aggregation`);
        return;
      }

      // Aggregate data for yesterday
      const analytics = await this.aggregateDataForDate(dateStr);
      
      if (analytics) {
        // Insert analytics into BigQuery
        await this.insertAnalytics(analytics);
        logger.info(`Successfully aggregated analytics for ${dateStr}`);
      } else {
        logger.warn(`No data available for analytics aggregation on ${dateStr}`);
      }

    } catch (error) {
      logger.error('Failed to aggregate daily analytics', { error });
      throw error;
    }
  }

  private async aggregateDataForDate(dateStr: string): Promise<DailyAnalytics | null> {
    try {
      const startTime = `${dateStr}T00:00:00Z`;
      const endTime = `${dateStr}T23:59:59Z`;

      // Get total vessels and positions
      const vesselStats = await this.getVesselStats(startTime, endTime);
      
      // Get incident statistics
      const incidentStats = await this.getIncidentStats(startTime, endTime);
      
      // Get top vessels by incidents
      const topVessels = await this.getTopVesselsByIncidents(startTime, endTime);
      
      // Get average vessel speed
      const avgSpeed = await this.getAverageVesselSpeed(startTime, endTime);
      
      // Get restricted zone violations
      const zoneViolations = await this.getRestrictedZoneViolations(startTime, endTime);

      if (vesselStats.total_vessels === 0) {
        return null; // No data for this date
      }

      return {
        date: dateStr,
        total_vessels: vesselStats.total_vessels,
        total_positions: vesselStats.total_positions,
        total_incidents: incidentStats.total_incidents,
        incidents_by_type: incidentStats.by_type,
        incidents_by_severity: incidentStats.by_severity,
        top_vessels_by_incidents: topVessels,
        average_vessel_speed: avgSpeed,
        restricted_zone_violations: zoneViolations,
        created_at: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to aggregate data for date', { error, dateStr });
      throw error;
    }
  }

  private async getVesselStats(startTime: string, endTime: string): Promise<{ total_vessels: number; total_positions: number }> {
    try {
      const query = `
        SELECT
          COUNT(DISTINCT mmsi) as total_vessels,
          COUNT(*) as total_positions
        FROM \`${this.BQ_DATASET}.vessel_positions\`
        WHERE timestamp BETWEEN @start AND @end
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { start: startTime, end: endTime },
        useLegacySql: false
      });

      if (job && job[0] && job[0][0]) {
        return {
          total_vessels: job[0][0].total_vessels || 0,
          total_positions: job[0][0].total_positions || 0
        };
      }

      return { total_vessels: 0, total_positions: 0 };

    } catch (error) {
      logger.error('Failed to get vessel stats', { error });
      return { total_vessels: 0, total_positions: 0 };
    }
  }

  private async getIncidentStats(startTime: string, endTime: string): Promise<{
    total_incidents: number;
    by_type: Record<string, number>;
    by_severity: Record<string, number>;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_incidents,
          type,
          severity
        FROM \`${this.BQ_DATASET}.incidents\`
        WHERE created_at BETWEEN @start AND @end
        GROUP BY type, severity
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { start: startTime, end: endTime },
        useLegacySql: false
      });

      let totalIncidents = 0;
      const byType: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};

      if (job && job[0]) {
        for (const row of job[0]) {
          totalIncidents += row.total_incidents || 0;
          
          byType[row.type] = (byType[row.type] || 0) + (row.total_incidents || 0);
          bySeverity[row.severity] = (bySeverity[row.severity] || 0) + (row.total_incidents || 0);
        }
      }

      return {
        total_incidents: totalIncidents,
        by_type: byType,
        by_severity: bySeverity
      };

    } catch (error) {
      logger.error('Failed to get incident stats', { error });
      return { total_incidents: 0, by_type: {}, by_severity: {} };
    }
  }

  private async getTopVesselsByIncidents(startTime: string, endTime: string): Promise<Array<{ mmsi: number; vessel_name: string; incident_count: number }>> {
    try {
      const query = `
        SELECT
          vessel_mmsi as mmsi,
          MAX(vessel_name) as vessel_name,
          COUNT(*) as incident_count
        FROM \`${this.BQ_DATASET}.incidents\`
        WHERE created_at BETWEEN @start AND @end
        GROUP BY vessel_mmsi
        ORDER BY incident_count DESC
        LIMIT 10
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { start: startTime, end: endTime },
        useLegacySql: false
      });

      if (job && job[0]) {
        return job[0].map((row: any) => ({
          mmsi: row.mmsi,
          vessel_name: row.vessel_name || `Vessel ${row.mmsi}`,
          incident_count: row.incident_count || 0
        }));
      }

      return [];

    } catch (error) {
      logger.error('Failed to get top vessels by incidents', { error });
      return [];
    }
  }

  private async getAverageVesselSpeed(startTime: string, endTime: string): Promise<number> {
    try {
      const query = `
        SELECT AVG(speed) as avg_speed
        FROM \`${this.BQ_DATASET}.vessel_positions\`
        WHERE timestamp BETWEEN @start AND @end
        AND speed > 0
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { start: startTime, end: endTime },
        useLegacySql: false
      });

      if (job && job[0] && job[0][0]) {
        return job[0][0].avg_speed || 0;
      }

      return 0;

    } catch (error) {
      logger.error('Failed to get average vessel speed', { error });
      return 0;
    }
  }

  private async getRestrictedZoneViolations(startTime: string, endTime: string): Promise<number> {
    try {
      const query = `
        SELECT COUNT(*) as violation_count
        FROM \`${this.BQ_DATASET}.incidents\`
        WHERE created_at BETWEEN @start AND @end
        AND type = 'PROXIMITY'
        AND details LIKE '%restricted%'
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { start: startTime, end: endTime },
        useLegacySql: false
      });

      if (job && job[0] && job[0][0]) {
        return job[0][0].violation_count || 0;
      }

      return 0;

    } catch (error) {
      logger.error('Failed to get restricted zone violations', { error });
      return 0;
    }
  }

  private async checkExistingAnalytics(dateStr: string): Promise<boolean> {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM \`${this.BQ_DATASET}.analytics\`
        WHERE date = @date
      `;

      const [job] = await this.bigquery.query({
        query,
        params: { date: dateStr },
        useLegacySql: false
      });

      if (job && job[0] && job[0][0]) {
        return (job[0][0].count || 0) > 0;
      }

      return false;

    } catch (error) {
      logger.warn('Failed to check existing analytics', { error });
      return false;
    }
  }

  private async insertAnalytics(analytics: DailyAnalytics): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('analytics');
      
      // Ensure table exists
      await this.ensureAnalyticsTableExists();
      
      // Insert analytics
      const [job] = await table.insert([analytics]);
      
      if (job.status.errors) {
        logger.error('Errors during analytics insert', { errors: job.status.errors });
        throw new Error('BigQuery insert failed');
      }

      logger.info(`Successfully inserted analytics for ${analytics.date}`);

    } catch (error) {
      logger.error('Failed to insert analytics', { error });
      throw error;
    }
  }

  private async ensureAnalyticsTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('analytics');
      
      const [exists] = await table.exists();
      if (!exists) {
        logger.info('Creating analytics table...');
        
        const schema = [
          { name: 'date', type: 'STRING', mode: 'REQUIRED' },
          { name: 'total_vessels', type: 'INT64' },
          { name: 'total_positions', type: 'INT64' },
          { name: 'total_incidents', type: 'INT64' },
          { name: 'incidents_by_type', type: 'STRING' }, // JSON string
          { name: 'incidents_by_severity', type: 'STRING' }, // JSON string
          { name: 'top_vessels_by_incidents', type: 'STRING' }, // JSON string
          { name: 'average_vessel_speed', type: 'FLOAT64' },
          { name: 'restricted_zone_violations', type: 'INT64' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
        ];
        
        await table.create({ 
          schema,
          timePartitioning: {
            type: 'DAY',
            field: 'created_at'
          },
          clustering: ['date']
        });
        
        logger.info('analytics table created successfully');
      }
    } catch (error) {
      logger.error('Failed to ensure analytics table exists', { error });
      throw error;
    }
  }
}
