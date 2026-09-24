import dotenv from 'dotenv';
import cron from 'node-cron';
import { config, TIME_CONSTANTS, getEnvironment } from '@svalmap/config';
import { logger } from './utils/logger';
import { AISDataProcessor } from './processors/AISDataProcessor';
import { IncidentDetector } from './processors/IncidentDetector';
import { SanctionsChecker } from './processors/SanctionsChecker';
import { AnalyticsAggregator } from './processors/AnalyticsAggregator';

// Load environment variables
dotenv.config();

class SvalMapJobScheduler {
  private aisProcessor: AISDataProcessor;
  private incidentDetector: IncidentDetector;
  private sanctionsChecker: SanctionsChecker;
  private analyticsAggregator: AnalyticsAggregator;

  constructor() {
    this.aisProcessor = new AISDataProcessor();
    this.incidentDetector = new IncidentDetector();
    this.sanctionsChecker = new SanctionsChecker();
    this.analyticsAggregator = new AnalyticsAggregator();
  }

  async start() {
    logger.info('Starting SvalMap job scheduler', {
      environment: getEnvironment(),
      updateInterval: TIME_CONSTANTS.UPDATE_INTERVALS.VESSEL_POSITIONS,
    });

    try {
      // Schedule vessel position updates every 5 minutes
      cron.schedule('*/5 * * * *', async () => {
        logger.info('Starting scheduled vessel position update');
        try {
          await this.aisProcessor.processVesselPositions();
          logger.info('Vessel position update completed successfully');
        } catch (error) {
          logger.error('Vessel position update failed', { error });
        }
      });

      // Schedule incident detection every 5 minutes
      cron.schedule('*/5 * * * *', async () => {
        logger.info('Starting scheduled incident detection');
        try {
          await this.incidentDetector.detectIncidents();
          logger.info('Incident detection completed successfully');
        } catch (error) {
          logger.error('Incident detection failed', { error });
        }
      });

      // Schedule sanctions checking every hour
      cron.schedule('0 * * * *', async () => {
        logger.info('Starting scheduled sanctions check');
        try {
          await this.sanctionsChecker.checkSanctions();
          logger.info('Sanctions check completed successfully');
        } catch (error) {
          logger.error('Sanctions check failed', { error });
        }
      });

      // Schedule analytics aggregation daily at 2 AM
      cron.schedule('0 2 * * *', async () => {
        logger.info('Starting scheduled analytics aggregation');
        try {
          await this.analyticsAggregator.aggregateDaily();
          logger.info('Analytics aggregation completed successfully');
        } catch (error) {
          logger.error('Analytics aggregation failed', { error });
        }
      });

      logger.info('All jobs scheduled successfully');

      // Run initial processing
      await this.runInitialProcessing();

    } catch (error) {
      logger.error('Failed to start job scheduler', { error });
      process.exit(1);
    }
  }

  private async runInitialProcessing() {
    logger.info('Running initial data processing');
    
    try {
      // Process any pending AIS data
      await this.aisProcessor.processVesselPositions();
      
      // Run initial incident detection
      await this.incidentDetector.detectIncidents();
      
      // Check sanctions
      await this.sanctionsChecker.checkSanctions();
      
      logger.info('Initial processing completed successfully');
    } catch (error) {
      logger.error('Initial processing failed', { error });
    }
  }

  async stop() {
    logger.info('Stopping SvalMap job scheduler');
    // Cleanup logic here if needed
  }
}

// Start the job scheduler
const scheduler = new SvalMapJobScheduler();

scheduler.start().catch((error) => {
  logger.error('Failed to start job scheduler', { error });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await scheduler.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await scheduler.stop();
  process.exit(0);
});

export default scheduler;
