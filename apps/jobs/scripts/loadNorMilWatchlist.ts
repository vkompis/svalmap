#!/usr/bin/env ts-node

import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface WatchlistEntry {
  mmsi: number;
  name: string;
  source: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const DATA_SOURCE_DIR = join(__dirname, '../../../data/source');
const WATCHLIST_FILE = join(DATA_SOURCE_DIR, 'Norwegian-military-vessel-mmsi.txt');

class NorwegianMilitaryWatchlistLoader {
  private bigquery: BigQuery;
  private entries: WatchlistEntry[] = [];
  private totalEntries = 0;
  private processedLines = 0;
  private skippedLines = 0;

  constructor() {
    this.bigquery = new BigQuery();
  }

  async loadWatchlist(): Promise<void> {
    console.log('🚀 Starting Norwegian Military Watchlist loading process...');
    console.log(`📊 Target dataset: ${BQ_DATASET}`);
    console.log(`📁 Source file: ${WATCHLIST_FILE}`);

    try {
      // Check if file exists
      if (!this.fileExists(WATCHLIST_FILE)) {
        throw new Error(`Watchlist file not found: ${WATCHLIST_FILE}`);
      }

      // Read and parse the watchlist file
      await this.parseWatchlistFile();

      // Bulk insert into BigQuery
      if (this.entries.length > 0) {
        await this.bulkInsertToBigQuery();
      }

      this.printSummary();
    } catch (error) {
      console.error('❌ Error during watchlist loading:', error);
      throw error;
    }
  }

  private async parseWatchlistFile(): Promise<void> {
    console.log('📖 Reading and parsing watchlist file...');

    try {
      const content = readFileSync(WATCHLIST_FILE, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      console.log(`📝 Found ${lines.length} lines to process`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip header lines or empty lines
        if (this.isHeaderLine(line) || line.length === 0) {
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

        this.processedLines++;
      }

      console.log(`✅ Parsed ${this.totalEntries} valid entries from ${this.processedLines} lines`);
    } catch (error) {
      console.error('❌ Error reading watchlist file:', error);
      throw error;
    }
  }

  private isHeaderLine(line: string): boolean {
    const headerPatterns = [
      /^MMSI/i,
      /^Name/i,
      /^Source/i,
      /^Notes/i,
      /^---/,
      /^#/,
      /^\s*$/,
      /^Vessel/i,
      /^Ship/i
    ];

    return headerPatterns.some(pattern => pattern.test(line));
  }

  private parseLine(line: string, lineNumber: number): WatchlistEntry | null {
    try {
      // Try different parsing strategies based on the line format
      let mmsi: number;
      let name: string;
      let source: string;
      let notes: string;

      // Strategy 1: Tab-separated values
      if (line.includes('\t')) {
        const parts = line.split('\t').map(part => part.trim());
        [mmsi, name, source, notes] = this.parseTabSeparated(parts, lineNumber);
      }
      // Strategy 2: Comma-separated values
      else if (line.includes(',')) {
        const parts = line.split(',').map(part => part.trim());
        [mmsi, name, source, notes] = this.parseCommaSeparated(parts, lineNumber);
      }
      // Strategy 3: Space-separated values (MMSI at start)
      else if (this.isNumericStart(line)) {
        [mmsi, name, source, notes] = this.parseSpaceSeparated(line, lineNumber);
      }
      // Strategy 4: Try to extract MMSI from anywhere in the line
      else {
        [mmsi, name, source, notes] = this.parseFlexible(line, lineNumber);
      }

      // Validate MMSI
      if (!this.isValidMMSI(mmsi)) {
        throw new Error(`Invalid MMSI: ${mmsi}`);
      }

      return {
        mmsi,
        name: name || `Unknown Vessel ${mmsi}`,
        source: source || 'Norwegian Armed Forces',
        notes: notes || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      console.warn(`⚠️  Parse error on line ${lineNumber}: "${line}" - ${error}`);
      return null;
    }
  }

  private parseTabSeparated(parts: string[], lineNumber: number): [number, string, string, string] {
    if (parts.length < 1) {
      throw new Error(`Insufficient parts in tab-separated line: ${parts.length}`);
    }

    const mmsi = this.parseMMSI(parts[0]);
    const name = parts[1] || '';
    const source = parts[2] || 'Norwegian Armed Forces';
    const notes = parts[3] || '';

    return [mmsi, name, source, notes];
  }

  private parseCommaSeparated(parts: string[], lineNumber: number): [number, string, string, string] {
    if (parts.length < 1) {
      throw new Error(`Insufficient parts in comma-separated line: ${parts.length}`);
    }

    const mmsi = this.parseMMSI(parts[0]);
    const name = parts[1] || '';
    const source = parts[2] || 'Norwegian Armed Forces';
    const notes = parts[3] || '';

    return [mmsi, name, source, notes];
  }

  private parseSpaceSeparated(line: string, lineNumber: number): [number, string, string, string] {
    // Find the first number (MMSI) at the start
    const mmsiMatch = line.match(/^(\d+)/);
    if (!mmsiMatch) {
      throw new Error('No MMSI found at start of line');
    }

    const mmsi = this.parseMMSI(mmsiMatch[1]);
    const remainingText = line.substring(mmsiMatch[1].length).trim();
    
    // Try to extract name and other information
    const name = this.extractNameFromText(remainingText);
    const source = 'Norwegian Armed Forces';
    const notes = remainingText.replace(name, '').trim();

    return [mmsi, name, source, notes];
  }

  private parseFlexible(line: string, lineNumber: number): [number, string, string, string] {
    // Try to find MMSI anywhere in the line
    const mmsiMatch = line.match(/(\d{9})/);
    if (!mmsiMatch) {
      throw new Error('No 9-digit MMSI found in line');
    }

    const mmsi = this.parseMMSI(mmsiMatch[1]);
    const remainingText = line.replace(mmsiMatch[1], '').trim();
    
    const name = this.extractNameFromText(remainingText);
    const source = 'Norwegian Armed Forces';
    const notes = remainingText.replace(name, '').trim();

    return [mmsi, name, source, notes];
  }

  private parseMMSI(mmsiStr: string): number {
    const mmsi = parseInt(mmsiStr, 10);
    if (isNaN(mmsi)) {
      throw new Error(`Invalid MMSI string: ${mmsiStr}`);
    }
    return mmsi;
  }

  private isValidMMSI(mmsi: number): boolean {
    // MMSI should be 9 digits
    return mmsi >= 100000000 && mmsi <= 999999999;
  }

  private isNumericStart(line: string): boolean {
    return /^\d/.test(line.trim());
  }

  private extractNameFromText(text: string): string {
    // Try to extract a vessel name from the remaining text
    // Look for common patterns like "KNM", "HNoMS", or quoted names
    
    // Pattern 1: KNM ShipName
    const knmMatch = text.match(/KNM\s+([A-Za-z0-9\s\-]+)/i);
    if (knmMatch) {
      return `KNM ${knmMatch[1].trim()}`;
    }

    // Pattern 2: HNoMS ShipName
    const hnomsMatch = text.match(/HNoMS\s+([A-Za-z0-9\s\-]+)/i);
    if (hnomsMatch) {
      return `HNoMS ${hnomsMatch[1].trim()}`;
    }

    // Pattern 3: Quoted name
    const quotedMatch = text.match(/"([^"]+)"/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Pattern 4: First word that looks like a name
    const words = text.split(/\s+/).filter(word => 
      word.length > 2 && /^[A-Za-z]/.test(word)
    );
    
    if (words.length > 0) {
      return words[0];
    }

    // Fallback: return first few words
    return text.split(/\s+/).slice(0, 3).join(' ').trim() || 'Unknown Vessel';
  }

  private async bulkInsertToBigQuery(): Promise<void> {
    console.log(`📤 Inserting ${this.entries.length} entries into BigQuery...`);
    
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('watchlist_mmsi');
      
      // Ensure table exists
      await this.ensureTableExists();
      
      // Insert data
      await table.insert(this.entries as any);
      console.log('✅ Successfully inserted watchlist entries into BigQuery');
    } catch (error: any) {
      if (error && error.name === 'PartialFailureError') {
        console.error('❌ Partial failures during insert:');
        const insertErrors = error.response?.insertErrors || [];
        insertErrors.forEach((entry: any) => {
          const idx = entry.index;
          const messages = (entry.errors || []).map((e: any) => `${e.reason}: ${e.message}`).join(' | ');
          const row = this.entries[idx];
          console.error(`  Row ${idx}: ${messages}`);
          if (row) {
            console.error(`    mmsi=${row.mmsi} name=${row.name}`);
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
      const table = dataset.table('watchlist_mmsi');
      
      const [exists] = await table.exists();
      if (!exists) {
        console.log('📋 Creating watchlist_mmsi table...');
        
        const schema = [
          { name: 'mmsi', type: 'INT64', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING' },
          { name: 'source', type: 'STRING' },
          { name: 'notes', type: 'STRING' },
          { name: 'created_at', type: 'TIMESTAMP' },
          { name: 'updated_at', type: 'TIMESTAMP' }
        ];
        
        await table.create({ schema });
        console.log('✅ watchlist_mmsi table created');
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
    console.log('\n📊 Norwegian Military Watchlist Loading Summary');
    console.log('==============================================');
    console.log(`✅ Total entries loaded: ${this.totalEntries}`);
    console.log(`📝 Lines processed: ${this.processedLines}`);
    console.log(`⚠️  Lines skipped: ${this.skippedLines}`);
    console.log(`🎯 Target dataset: ${BQ_DATASET}`);
    console.log(`📅 Completed at: ${new Date().toISOString()}`);
    
    if (this.entries.length > 0) {
      console.log('\n📋 Sample entries:');
      this.entries.slice(0, 5).forEach(entry => {
        console.log(`  - MMSI: ${entry.mmsi}, Name: ${entry.name}, Source: ${entry.source}`);
      });
      
      if (this.entries.length > 5) {
        console.log(`  ... and ${this.entries.length - 5} more entries`);
      }
    }
  }
}

// Main execution
async function main() {
  try {
    const loader = new NorwegianMilitaryWatchlistLoader();
    await loader.loadWatchlist();
    console.log('\n🎉 Norwegian Military Watchlist loading completed successfully!');
  } catch (error) {
    console.error('\n💥 Norwegian Military Watchlist loading failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { NorwegianMilitaryWatchlistLoader };
