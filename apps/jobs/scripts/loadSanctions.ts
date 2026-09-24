#!/usr/bin/env ts-node

import { BigQuery } from '@google-cloud/bigquery';
import axios from 'axios';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface SanctionsEntry {
  mmsi?: number;
  imo?: string;
  name: string;
  source: string;
  source_id: string;
  entity_type: string;
  country: string;
  reason: string;
  effective_date: string;
  last_updated: string;
  created_at: string;
  updated_at: string;
}

interface SanctionsSource {
  name: string;
  url: string;
  parser: (content: string) => Promise<SanctionsEntry[]>;
}

const BQ_DATASET = process.env.BQ_DATASET || 'svalmap.marine_osint';
const CACHE_DIR = join(__dirname, '../../../data/cache');
const SANCTIONS_CACHE_DIR = join(CACHE_DIR, 'sanctions');

class SanctionsLoader {
  private bigquery: BigQuery;
  private entries: SanctionsEntry[] = [];
  private processedSources: string[] = [];
  private totalEntries = 0;
  private errors: string[] = [];

  constructor() {
    this.bigquery = new BigQuery();
    this.ensureCacheDirectories();
  }

  private ensureCacheDirectories(): void {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (!existsSync(SANCTIONS_CACHE_DIR)) {
      mkdirSync(SANCTIONS_CACHE_DIR, { recursive: true });
    }
  }

  async loadSanctions(): Promise<void> {
    console.log('🚀 Starting sanctions data loading process...');
    console.log(`📊 Target dataset: ${BQ_DATASET}`);

    try {
      // Define sanctions sources
      const sources: SanctionsSource[] = [
        {
          name: 'EU Sanctions',
          url: 'https://webgate.ec.europa.eu/europeaid/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
          parser: this.parseEUSanctions.bind(this)
        },
        {
          name: 'OFAC SDN',
          url: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
          parser: this.parseOFACSanctions.bind(this)
        },
        {
          name: 'UK HMT',
          url: 'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1186299/UK_Sanctions_List.csv',
          parser: this.parseUKSanctions.bind(this)
        }
      ];

      // Process each source
      for (const source of sources) {
        await this.processSanctionsSource(source);
      }

      // Bulk insert into BigQuery
      if (this.entries.length > 0) {
        await this.bulkInsertToBigQuery();
      }

      this.printSummary();
    } catch (error) {
      console.error('❌ Error during sanctions loading:', error);
      throw error;
    }
  }

  private async processSanctionsSource(source: SanctionsSource): Promise<void> {
    console.log(`📖 Processing ${source.name}...`);
    
    try {
      // Fetch data
      const response = await axios.get(source.url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'SvalMap-Sanctions-Loader/1.0'
        }
      });

      // Cache the raw data
      const cacheFile = join(SANCTIONS_CACHE_DIR, `${source.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.txt`);
      writeFileSync(cacheFile, response.data);

      // Parse the data
      const entries = await source.parser(response.data);
      
      // Filter for marine-related entries
      const marineEntries = this.filterMarineEntries(entries);
      
      this.entries.push(...marineEntries);
      this.processedSources.push(source.name);
      this.totalEntries += marineEntries.length;
      
      console.log(`✅ Processed ${source.name}: ${marineEntries.length} marine entries`);
    } catch (error) {
      const errorMsg = `Error processing ${source.name}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      this.errors.push(errorMsg);
    }
  }

  private async parseEUSanctions(content: string): Promise<SanctionsEntry[]> {
    // EU sanctions come as XML, but we'll look for vessel-related entries
    const entries: SanctionsEntry[] = [];
    
    try {
      // Simple text parsing for vessel names (in production, use proper XML parser)
      const lines = content.split('\n');
      const vesselKeywords = ['vessel', 'ship', 'tanker', 'cargo', 'fishing', 'yacht'];
      
      for (const line of lines) {
        if (vesselKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
          // Extract vessel information (simplified parsing)
          const nameMatch = line.match(/<name>([^<]+)<\/name>/i);
          const countryMatch = line.match(/<country>([^<]+)<\/country>/i);
          
          if (nameMatch) {
            entries.push({
              name: nameMatch[1].trim(),
              source: 'EU Sanctions',
              source_id: `eu_${Date.now()}_${entries.length}`,
              entity_type: 'vessel',
              country: countryMatch ? countryMatch[1].trim() : 'Unknown',
              reason: 'EU Sanctions List',
              effective_date: new Date().toISOString().split('T')[0],
              last_updated: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.warn('Warning: EU sanctions parsing failed, using fallback method');
    }
    
    return entries;
  }

  private async parseOFACSanctions(content: string): Promise<SanctionsEntry[]> {
    const entries: SanctionsEntry[] = [];
    
    try {
      const lines = content.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const values = this.parseCSVLine(line);
        if (values.length < headers.length) continue;
        
        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index]?.replace(/"/g, '').trim();
        });
        
        // Look for vessel-related entries
        if (this.isVesselEntry(row)) {
          const entry: SanctionsEntry = {
            name: row['SDN Name'] || row['Name'] || 'Unknown',
            source: 'OFAC SDN',
            source_id: row['SDN ID'] || `ofac_${Date.now()}_${entries.length}`,
            entity_type: 'vessel',
            country: row['Country'] || 'Unknown',
            reason: row['Remarks'] || 'OFAC Sanctions',
            effective_date: row['Effective Date'] || new Date().toISOString().split('T')[0],
            last_updated: row['Last Updated'] || new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          // Try to extract MMSI or IMO
          if (row['Remarks']) {
            const mmsiMatch = row['Remarks'].match(/\b(\d{9})\b/);
            if (mmsiMatch) {
              entry.mmsi = parseInt(mmsiMatch[1], 10);
            }
            
            const imoMatch = row['Remarks'].match(/\bIMO\s*(\d{7})\b/i);
            if (imoMatch) {
              entry.imo = imoMatch[1];
            }
          }
          
          entries.push(entry);
        }
      }
    } catch (error) {
      console.warn('Warning: OFAC sanctions parsing failed:', error);
    }
    
    return entries;
  }

  private async parseUKSanctions(content: string): Promise<SanctionsEntry[]> {
    const entries: SanctionsEntry[] = [];
    
    try {
      const lines = content.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const values = this.parseCSVLine(line);
        if (values.length < headers.length) continue;
        
        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index]?.replace(/"/g, '').trim();
        });
        
        // Look for vessel-related entries
        if (this.isVesselEntry(row)) {
          const entry: SanctionsEntry = {
            name: row['Name'] || row['Entity Name'] || 'Unknown',
            source: 'UK HMT',
            source_id: row['Reference'] || `uk_${Date.now()}_${entries.length}`,
            entity_type: 'vessel',
            country: row['Country'] || 'Unknown',
            reason: row['Reason'] || 'UK Sanctions',
            effective_date: row['Date'] || new Date().toISOString().split('T')[0],
            last_updated: row['Last Updated'] || new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          // Try to extract MMSI or IMO
          if (row['Notes'] || row['Reason']) {
            const text = (row['Notes'] || '') + ' ' + (row['Reason'] || '');
            const mmsiMatch = text.match(/\b(\d{9})\b/);
            if (mmsiMatch) {
              entry.mmsi = parseInt(mmsiMatch[1], 10);
            }
            
            const imoMatch = text.match(/\bIMO\s*(\d{7})\b/i);
            if (imoMatch) {
              entry.imo = imoMatch[1];
            }
          }
          
          entries.push(entry);
        }
      }
    } catch (error) {
      console.warn('Warning: UK sanctions parsing failed:', error);
    }
    
    return entries;
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

  private isVesselEntry(row: any): boolean {
    const vesselKeywords = ['vessel', 'ship', 'tanker', 'cargo', 'fishing', 'yacht', 'boat'];
    const text = JSON.stringify(row).toLowerCase();
    
    return vesselKeywords.some(keyword => text.includes(keyword)) ||
           (row['Type'] && vesselKeywords.some(keyword => row['Type'].toLowerCase().includes(keyword)));
  }

  private filterMarineEntries(entries: SanctionsEntry[]): SanctionsEntry[] {
    // Filter for entries that are likely marine-related
    return entries.filter(entry => {
      // Must have a name
      if (!entry.name || entry.name === 'Unknown') return false;
      
      // Must be marked as vessel type
      if (entry.entity_type !== 'vessel') return false;
      
      // Must have some identifying information
      return entry.mmsi || entry.imo || entry.name.length > 2;
    });
  }

  private async bulkInsertToBigQuery(): Promise<void> {
    console.log(`📤 Inserting ${this.entries.length} sanctions entries into BigQuery...`);
    
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('sanctions_mmsi');
      
      // Ensure table exists
      await this.ensureTableExists();
      
      // Insert data
      const [job] = await table.insert(this.entries);
      
      if (job.status.errors) {
        console.error('❌ Errors during BigQuery insert:', job.status.errors);
      } else {
        console.log('✅ Successfully inserted sanctions entries into BigQuery');
      }
    } catch (error) {
      console.error('❌ Error inserting into BigQuery:', error);
      throw error;
    }
  }

  private async ensureTableExists(): Promise<void> {
    try {
      const dataset = this.bigquery.dataset(BQ_DATASET.split('.')[1]);
      const table = dataset.table('sanctions_mmsi');
      
      const [exists] = await table.exists();
      if (!exists) {
        console.log('📋 Creating sanctions_mmsi table...');
        
        const schema = [
          { name: 'mmsi', type: 'INT64' },
          { name: 'imo', type: 'STRING' },
          { name: 'name', type: 'STRING', mode: 'REQUIRED' },
          { name: 'source', type: 'STRING', mode: 'REQUIRED' },
          { name: 'source_id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'entity_type', type: 'STRING' },
          { name: 'country', type: 'STRING' },
          { name: 'reason', type: 'STRING' },
          { name: 'effective_date', type: 'STRING' },
          { name: 'last_updated', type: 'STRING' },
          { name: 'created_at', type: 'TIMESTAMP' },
          { name: 'updated_at', type: 'TIMESTAMP' }
        ];
        
        await table.create({ schema });
        console.log('✅ sanctions_mmsi table created');
      }
    } catch (error) {
      console.error('❌ Error ensuring table exists:', error);
      throw error;
    }
  }

  private printSummary(): void {
    console.log('\n📊 Sanctions Loading Summary');
    console.log('============================');
    console.log(`✅ Total entries loaded: ${this.totalEntries}`);
    console.log(`📁 Sources processed: ${this.processedSources.length}`);
    console.log(`🎯 Target dataset: ${BQ_DATASET}`);
    console.log(`📅 Completed at: ${new Date().toISOString()}`);
    
    if (this.processedSources.length > 0) {
      console.log('\n📋 Processed sources:');
      this.processedSources.forEach(source => console.log(`  - ${source}`));
    }
    
    if (this.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      this.errors.forEach(error => console.log(`  - ${error}`));
    }
  }
}

// Main execution
async function main() {
  try {
    const loader = new SanctionsLoader();
    await loader.loadSanctions();
    console.log('\n🎉 Sanctions loading completed successfully!');
  } catch (error) {
    console.error('\n💥 Sanctions loading failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { SanctionsLoader };
