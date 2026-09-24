import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { Incident, IncidentType, IncidentSeverity } from '@svalmap/types';

interface DetectionResult {
  type: IncidentType;
  severity: IncidentSeverity;
  vessel_mmsi: number;
  vessel_name?: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  details: string;
  confidence: number;
}

export class IncidentDetector {
  private bigquery: BigQuery;
  private readonly BQ_DATASET: string;
  private readonly SQL_SCRIPTS_DIR: string;

  constructor() {
    this.bigquery = new BigQuery();
    this.BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
    this.SQL_SCRIPTS_DIR = join(__dirname, '../../../sql');
  }

  async detectIncidents(): Promise<void> {
    logger.info('Starting incident detection process');

    try {
      const allIncidents: Incident[] = [];

      // Run all detection scripts
      const detectionScripts = [
        { name: 'proximity', file: 'proximity_last_5min.sql', type: IncidentType.PROXIMITY },
        { name: 'rendezvous', file: 'rendezvous_last_24h.sql', type: IncidentType.RENDEZVOUS },
        { name: 'loitering', file: 'loiter_last_24h.sql', type: IncidentType.LOITERING },
        { name: 'sanctions', file: 'sanctions_match_refresh.sql', type: IncidentType.SANCTIONS_VIOLATION },
        { name: 'shadow', file: 'shadow_entry_last_5min.sql', type: IncidentType.SHADOW_FLEET },
        { name: 'research', file: 'research_entry_last_5min.sql', type: IncidentType.RESEARCH_MONITORING }
      ];

      for (const script of detectionScripts) {
        try {
          logger.info(`Running ${script.name} detection`);
          const incidents = await this.runDetectionScript(script.file, script.type);
          allIncidents.push(...incidents);
          logger.info(`Completed ${script.name} detection: ${incidents.length} incidents found`);
        } catch (error) {
          logger.error(`Failed to run ${script.name} detection`, { error });
        }
      }

      // Filter out duplicates and apply cooldown
      const uniqueIncidents = await this.filterDuplicateIncidents(allIncidents);

      if (uniqueIncidents.length > 0) {
        // Insert new incidents into BigQuery
        await this.insertIncidentsIntoBigQuery(uniqueIncidents);

        // Write incident summaries to Firestore for UI
        await this.writeIncidentSummariesToFirestore(uniqueIncidents);

        logger.info(`Successfully processed ${uniqueIncidents.length} new incidents`);
      } else {
        logger.info('No new incidents detected');
      }

    } catch (error) {
      logger.error('Failed to detect incidents', { error });
      throw error;
    }
  }

  private async runDetectionScript(scriptFile: string, incidentType: IncidentType): Promise<Incident[]> {
    try {
      const scriptPath = join(this.SQL_SCRIPTS_DIR, scriptFile);
      const sqlQuery = readFileSync(scriptPath, 'utf8');

      // Replace dataset placeholder
      const query = sqlQuery.replace(/\${BQ_DATASET}/g, this.BQ_DATASET);

      logger.info(`Executing ${scriptFile} for ${incidentType}`);

      const [job] = await this.bigquery.query({
        query,
        useLegacySql: false
      });

      if (job.errors && job.errors.length > 0) {
        throw new Error(`BigQuery query failed: ${JSON.stringify(job.errors)}`);
      }

      // Convert results to Incident objects
      const incidents: Incident[] = [];
      if (job && job[0]) {
        for (const row of job[0]) {
          const incident = this.convertRowToIncident(row, incidentType);
          if (incident) {
            incidents.push(incident);
          }
        }
      }

      return incidents;

    } catch (error) {
      logger.error(`Failed to run detection script ${scriptFile}`, { error });
      throw error;
    }
  }

  private convertRowToIncident(row: any, type: IncidentType): Incident | null {
    try {
      // Map common fields from detection results
      const incident: Incident = {
        id: this.generateIncidentId(type, row.vessel_mmsi || row.mmsi),
        type,
        severity: this.mapSeverity(row.severity || row.risk_level || 'MEDIUM'),
        vessel_mmsi: row.vessel_mmsi || row.mmsi,
        vessel_name: row.vessel_name || row.name || null,
        latitude: row.latitude || row.lat || 0,
        longitude: row.longitude || row.lon || 0,
        timestamp: row.timestamp || row.time || new Date().toISOString(),
        details: row.details || row.description || row.notes || '',
        confidence: row.confidence || row.confidence_score || 0.8,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Validate required fields
      if (!incident.vessel_mmsi || !incident.latitude || !incident.longitude) {
        logger.warn('Skipping incident with missing required fields', { row });
        return null;
      }

      return incident;
    } catch (error) {
      logger.warn('Failed to convert row to incident', { error, row });
      return null;
    }
  }

  private mapSeverity(severity: string): IncidentSeverity {
    const severityMap: Record<string, IncidentSeverity> = {
      'LOW': IncidentSeverity.LOW,
      'MEDIUM': IncidentSeverity.MEDIUM,
      'HIGH': IncidentSeverity.HIGH,
      'CRITICAL': IncidentSeverity.CRITICAL
    };

    return severityMap[severity.toUpperCase()] || IncidentSeverity.MEDIUM;
  }

  private generateIncidentId(type: IncidentType, mmsi: number): string {
    return `${type.toLowerCase()}_${mmsi}_${Date.now()}`;
  }

  private async filterDuplicateIncidents(incidents: Incident[]): Promise<Incident[]> {
    try {
      // Check for existing incidents in the last 45 minutes (cooldown period)
      const cooldownMinutes = 45;
      const cutoffTime = new Date(Date.now() - cooldownMinutes * 60 * 1000);

      const uniqueIncidents: Incident[] = [];
      
      for (const incident of incidents) {
        const isDuplicate = await this.checkDuplicateIncident(incident, cutoffTime);
        if (!isDuplicate) {
          uniqueIncidents.push(incident);
        }
      }

      logger.info(`Filtered ${incidents.length} incidents to ${uniqueIncidents.length} unique incidents after cooldown check`);
      return uniqueIncidents;

    } catch (error) {
      logger.error('Failed to filter duplicate incidents', { error });
      // Return all incidents if filtering fails
      return incidents;
    }
  }

  private async checkDuplicateIncident(incident: Incident, cutoffTime: Date): Promise<boolean> {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM \`${this.BQ_DATASET}.incidents\`
        WHERE type = @type
        AND vessel_mmsi = @mmsi
        AND created_at > @cutoff
        AND status = 'ACTIVE'
      `;

      const [job] = await this.bigquery.query({
        query,
        params: {
          type: incident.type,
          mmsi: incident.vessel_mmsi,
          cutoff: cutoffTime.toISOString()
        },
        useLegacySql: false
      });

      if (job && job[0] && job[0][0]) {
        return job[0][0].count > 0;
      }

      return false;

    } catch (error) {
      logger.warn('Failed to check duplicate incident', { error, incident });
      return false;
    }
  }

  private async insertIncidentsIntoBigQuery(incidents: Incident[]): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('incidents');
      
      // Ensure table exists
      await this.ensureIncidentsTableExists();
      
      // Insert incidents
      const [job] = await table.insert(incidents);
      
      if (job.status.errors) {
        logger.error('Errors during incidents BigQuery insert', { errors: job.status.errors });
        throw new Error('BigQuery insert failed');
      }

      logger.info(`Successfully inserted ${incidents.length} incidents into BigQuery`);

    } catch (error) {
      logger.error('Failed to insert incidents into BigQuery', { error });
      throw error;
    }
  }

  private async ensureIncidentsTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(this.BQ_DATASET.split('.')[1]);
      const table = dataset.table('incidents');
      
      const [exists] = await table.exists();
      if (!exists) {
        logger.info('Creating incidents table...');
        
        const schema = [
          { name: 'id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'type', type: 'STRING', mode: 'REQUIRED' },
          { name: 'severity', type: 'STRING', mode: 'REQUIRED' },
          { name: 'vessel_mmsi', type: 'INT64', mode: 'REQUIRED' },
          { name: 'vessel_name', type: 'STRING' },
          { name: 'latitude', type: 'FLOAT64', mode: 'REQUIRED' },
          { name: 'longitude', type: 'FLOAT64', mode: 'REQUIRED' },
          { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
          { name: 'details', type: 'STRING' },
          { name: 'confidence', type: 'FLOAT64' },
          { name: 'status', type: 'STRING', mode: 'REQUIRED' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
          { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
        ];
        
        await table.create({ 
          schema,
          timePartitioning: {
            type: 'DAY',
            field: 'created_at'
          },
          clustering: ['type', 'vessel_mmsi', 'created_at']
        });
        
        logger.info('incidents table created successfully');
      }
    } catch (error) {
      logger.error('Failed to ensure incidents table exists', { error });
      throw error;
    }
  }

  private async writeIncidentSummariesToFirestore(incidents: Incident[]): Promise<void> {
    try {
      // This would integrate with Firestore to store incident summaries for the UI
      // For now, we'll log the summaries
      logger.info('Writing incident summaries to Firestore', {
        count: incidents.length,
        types: [...new Set(incidents.map(i => i.type))],
        severities: [...new Set(incidents.map(i => i.severity))]
      });

      // TODO: Implement Firestore integration
      // const firestore = new Firestore();
      // const batch = firestore.batch();
      
      // for (const incident of incidents) {
      //   const summary = {
      //     id: incident.id,
      //     type: incident.type,
      //     severity: incident.severity,
      //     vessel_name: incident.vessel_name,
      //     location: `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`,
      //     timestamp: incident.timestamp,
      //     details: incident.details,
      //     created_at: incident.created_at
      //   };
      //   
      //   const docRef = firestore.collection('incident_summaries').doc(incident.id);
      //   batch.set(docRef, summary);
      // }
      // 
      // await batch.commit();

    } catch (error) {
      logger.error('Failed to write incident summaries to Firestore', { error });
      // Don't throw - this is not critical for the main detection process
    }
  }
}
