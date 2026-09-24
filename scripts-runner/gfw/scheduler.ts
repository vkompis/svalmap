import cron from 'node-cron';
import ingestAisOff from './jobs/ingestAisOff';
import ingestEncounters from './jobs/ingestEncounters';

// AIS off is most critical: run every 10 minutes
cron.schedule('*/10 * * * *', () => {
  console.log('Starting AIS off ingestion...');
  ingestAisOff().catch(console.error);
});

// Encounters: run every 30 minutes
cron.schedule('*/30 * * * *', () => {
  console.log('Starting encounters ingestion...');
  ingestEncounters().catch(console.error);
});

// Optionally, run once at boot
(async () => {
  console.log('Running initial GFW ingestion...');
  await ingestAisOff().catch(console.error);
  await ingestEncounters().catch(console.error);
})();



