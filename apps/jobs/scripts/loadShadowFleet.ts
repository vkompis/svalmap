#!/usr/bin/env ts-node

import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';

interface ShadowFleetEntry {
  mmsi?: number;
  imo?: string;
  name: string;
  last_known_flag: string;
  vessel_type: string;
  source: string;
  notes: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  last_seen?: string;
  created_at: string;
  updated_at: string;
}

const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const DATA_SOURCE_DIR = join(__dirname, '../../../data/source');
const SHADOWFLEET_FILE = join(DATA_SOURCE_DIR, 'shadowfleet.csv');

class ShadowFleetLoader {
  private bigquery: BigQuery;
  private entries: ShadowFleetEntry[] = [];
  private processedFiles: string[] = [];
  private totalEntries = 0;
  private skippedLines = 0;

  constructor() {
    this.bigquery = new BigQuery();
  }

  async loadShadowFleet(): Promise<void> {
    console.log('🚀 Starting Shadow Fleet data loading process...');
    console.log(`📊 Target dataset: ${BQ_DATASET}`);
    console.log(`📁 Source file: ${SHADOWFLEET_FILE}`);

    try {
      // Check if file exists
      if (!this.fileExists(SHADOWFLEET_FILE)) {
        console.warn(`⚠️  Shadow fleet file not found: ${SHADOWFLEET_FILE}`);
        console.log('📝 Creating sample shadow fleet data...');
        await this.createSampleData();
      }

      // Read and parse the shadow fleet file
      await this.parseShadowFleetFile();

      // Bulk insert into BigQuery
      if (this.entries.length > 0) {
        await this.bulkInsertToBigQuery();
      }

      this.printSummary();
    } catch (error) {
      console.error('❌ Error during shadow fleet loading:', error);
      throw error;
    }
  }

  private async createSampleData(): Promise<void> {
    const sampleData = `mmsi,imo,name,last_known_flag,vessel_type,source,notes,risk_level,last_seen
123456789,1234567,UNKNOWN TANKER 1,Unknown,Tanker,OSINT,Shadow fleet vessel with irregular AIS patterns,HIGH,2024-01-15
234567890,2345678,UNKNOWN CARGO 1,Unknown,Cargo,OSINT,Multiple flag changes, suspicious behavior,CRITICAL,2024-01-10
345678901,3456789,UNKNOWN FISHING 1,Unknown,Fishing,OSINT,Operating in restricted areas,MEDIUM,2024-01-12
456789012,4567890,UNKNOWN TANKER 2,Unknown,Tanker,OSINT,Multiple identity changes,CRITICAL,2024-01-08
567890123,5678901,UNKNOWN CARGO 2,Unknown,Cargo,OSINT,Irregular port calls,HIGH,2024-01-05`;

    try {
      const fs = require('fs');
      fs.writeFileSync(SHADOWFLEET_FILE, sampleData);
      console.log('✅ Sample shadow fleet data created');
    } catch (error) {
      console.warn('⚠️  Could not create sample data:', error);
    }
  }

  private async parseShadowFleetFile(): Promise<void> {
    console.log('📖 Reading and parsing shadow fleet file...');

    try {
      const content = readFileSync(SHADOWFLEET_FILE, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      console.log(`📝 Found ${lines.length} lines to process`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip header line
        if (i === 0 && this.isHeaderLine(line)) {
          this.skippedLines++;
          continue;
        }

        try {
          const entry = this.parseLine(line, i + 1);
          if (entry) {
            this.entries.push(entry);
            this.totalEntries++;
          }
        } catch (error) {
          console.warn(`⚠️  Warning: Could not parse line ${i + 1}: "${line}" - ${error}`);
          this.skippedLines++;
        }
      }

      console.log(`✅ Parsed ${this.totalEntries} valid entries from ${lines.length} lines`);
    } catch (error) {
      console.error('❌ Error reading shadow fleet file:', error);
      throw error;
    }
  }

  private isHeaderLine(line: string): boolean {
    const headerPatterns = [
      /^mmsi/i,
      /^imo/i,
      /^name/i,
      /^flag/i,
      /^type/i,
      /^source/i,
      /^notes/i,
      /^risk/i,
      /^last/i,
      /^---/,
      /^#/
    ];

    return headerPatterns.some(pattern => pattern.test(line));
  }

  private parseLine(line: string, lineNumber: number): ShadowFleetEntry | null {
    try {
      // Parse CSV line with proper handling of quoted fields
      const parts = this.parseCSVLine(line);
      
      if (parts.length < 6) {
        throw new Error(`Insufficient fields: ${parts.length} (expected at least 6)`);
      }

      const [mmsiStr, imoStr, name, lastKnownFlag, vesselType, source, notes = '', riskLevel = 'MEDIUM', lastSeen = ''] = parts;

      // Parse MMSI
      let mmsi: number | undefined;
      if (mmsiStr && mmsiStr.trim() && mmsiStr !== 'Unknown') {
        const mmsiNum = parseInt(mmsiStr.trim(), 10);
        if (!isNaN(mmsiNum) && this.isValidMMSI(mmsiNum)) {
          mmsi = mmsiNum;
        }
      }

      // Parse IMO
      let imo: string | undefined;
      if (imoStr && imoStr.trim() && imoStr !== 'Unknown') {
        const imoNum = imoStr.trim();
        if (this.isValidIMO(imoNum)) {
          imo = imoNum;
        }
      }

      // Validate required fields
      if (!name || name.trim() === 'Unknown') {
        throw new Error('Name is required');
      }

      if (!lastKnownFlag || lastKnownFlag.trim() === 'Unknown') {
        throw new Error('Last known flag is required');
      }

      if (!vesselType || vesselType.trim() === 'Unknown') {
        throw new Error('Vessel type is required');
      }

      if (!source || source.trim() === 'Unknown') {
        throw new Error('Source is required');
      }

      // Validate risk level
      const validRiskLevels: Array<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      const normalizedRiskLevel = riskLevel.toUpperCase() as any;
      if (!validRiskLevels.includes(normalizedRiskLevel)) {
        throw new Error(`Invalid risk level: ${riskLevel}`);
      }

      return {
        mmsi,
        imo,
        name: name.trim(),
        last_known_flag: lastKnownFlag.trim(),
        vessel_type: vesselType.trim(),
        source: source.trim(),
        notes: notes.trim(),
        risk_level: normalizedRiskLevel,
        last_seen: lastSeen.trim() || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      console.warn(`⚠️  Parse error on line ${lineNumber}: "${line}" - ${error}`);
      return null;
    }
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current);
    return result;
  }

  private isValidMMSI(mmsi: number): boolean {
    // MMSI should be 9 digits
    return mmsi >= 100000000 && mmsi <= 999999999;
  }

  private isValidIMO(imo: string): boolean {
    // IMO should be 7 digits
    return /^\d{7}$/.test(imo);
  }

  private async bulkInsertToBigQuery(): Promise<void> {
    console.log(`📤 Inserting ${this.entries.length} shadow fleet entries into BigQuery...`);
    
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('shadowfleet_mmsi');
      
      // Ensure table exists
      await this.ensureTableExists();
      
      // Insert data
      const [job] = await table.insert(this.entries);
      
      if (job.status.errors) {
        console.error('❌ Errors during BigQuery insert:', job.status.errors);
      } else {
        console.log('✅ Successfully inserted shadow fleet entries into BigQuery');
      }
    } catch (error) {
      console.error('❌ Error inserting into BigQuery:', error);
      throw error;
    }
  }

  private async ensureTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('shadowfleet_mmsi');
      
      const [exists] = await table.exists();
      if (!exists) {
        console.log('📋 Creating shadowfleet_mmsi table...');
        
        const schema = [
          { name: 'mmsi', type: 'INT64' },
          { name: 'imo', type: 'STRING' },
          { name: 'name', type: 'STRING', mode: 'REQUIRED' },
          { name: 'last_known_flag', type: 'STRING', mode: 'REQUIRED' },
          { name: 'vessel_type', type: 'STRING', mode: 'REQUIRED' },
          { name: 'source', type: 'STRING', mode: 'REQUIRED' },
          { name: 'notes', type: 'STRING' },
          { name: 'risk_level', type: 'STRING', mode: 'REQUIRED' },
          { name: 'last_seen', type: 'STRING' },
          { name: 'created_at', type: 'TIMESTAMP' },
          { name: 'updated_at', type: 'TIMESTAMP' }
        ];
        
        await table.create({ schema });
        console.log('✅ shadowfleet_mmsi table created');
      }
    } catch (error) {
      console.error('❌ Error ensuring table exists:', error);
      throw error;
    }
  }

  private fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }

  private printSummary(): void {
    console.log('\n📊 Shadow Fleet Loading Summary');
    console.log('================================');
    console.log(`✅ Total entries loaded: ${this.totalEntries}`);
    console.log(`📝 Lines processed: ${this.totalEntries + this.skippedLines}`);
    console.log(`⚠️  Lines skipped: ${this.skippedLines}`);
    console.log(`🎯 Target dataset: ${BQ_DATASET}`);
    console.log(`📅 Completed at: ${new Date().toISOString()}`);
    
    if (this.entries.length > 0) {
      console.log('\n📋 Sample entries:');
      this.entries.slice(0, 5).forEach(entry => {
        console.log(`  - MMSI: ${entry.mmsi || 'N/A'}, Name: ${entry.name}, Risk: ${entry.risk_level}`);
      });
      
      if (this.entries.length > 5) {
        console.log(`  ... and ${this.entries.length - 5} more entries`);
      }

      // Risk level breakdown
      const riskBreakdown = this.entries.reduce((acc, entry) => {
        acc[entry.risk_level] = (acc[entry.risk_level] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n🚨 Risk Level Breakdown:');
      Object.entries(riskBreakdown).forEach(([level, count]) => {
        console.log(`  - ${level}: ${count} vessels`);
      });
    }
  }
}

// Main execution
async function main() {
  try {
    const loader = new ShadowFleetLoader();
    await loader.loadShadowFleet();
    console.log('\n🎉 Shadow Fleet loading completed successfully!');
  } catch (error) {
    console.error('\n💥 Shadow Fleet loading failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { ShadowFleetLoader };
