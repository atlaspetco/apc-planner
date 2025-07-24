/**
 * Duration Consolidation Script (TypeScript equivalent of pandas approach)
 * 
 * This script consolidates work cycle durations by grouping identical work cycles
 * and summing their durations. This fixes the CSV export issue where one-to-many
 * relationships created multiple rows with repeated total durations instead of
 * individual cycle durations.
 */

import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface WorkCycleRow {
  'work/rec_name': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/work_center/category/name': string;
  'work/cycles/work/production/routing/name': string;
  'work/production/id': string;
  'work/id': string;
  'work/production/create_date': string;
  'work/production/quantity_done': string;
  'work/cycles/duration': string;
  [key: string]: string;
}

interface ConsolidatedRow {
  'work/rec_name': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/work_center/category/name': string;
  'work/cycles/work/production/routing/name': string;
  'work/production/id': string;
  'work/id': string;
  'work/production/create_date': string;
  'work/production/quantity_done': string;
  duration_sec: number;
}

function durationToSeconds(duration: string): number {
  // Handle various duration formats from Fulfil API
  // Examples: "01:30:00", "0:45:30", "2:15:45"
  if (!duration || duration === '') return 0;
  
  const parts = duration.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseInt(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  // If not in HH:MM:SS format, try to parse as seconds
  const numValue = parseFloat(duration);
  return isNaN(numValue) ? 0 : numValue;
}

function createGroupKey(row: WorkCycleRow): string {
  // Create unique key for grouping identical work cycles
  const keyParts = [
    row['work/rec_name'],
    row['work/cycles/operator/rec_name'],
    row['work/cycles/work_center/category/name'],
    row['work/cycles/work/production/routing/name'],
    row['work/production/id'],
    row['work/id'],
    row['work/production/create_date'],
    row['work/production/quantity_done']
  ];
  
  return keyParts.join('|');
}

export async function consolidateDurations(inputFile: string, outputFile: string): Promise<void> {
  console.log(`📊 Starting duration consolidation from ${inputFile}...`);
  
  try {
    // Load CSV data
    const csvContent = readFileSync(inputFile, 'utf-8');
    const rows: WorkCycleRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });
    
    console.log(`📋 Loaded ${rows.length} rows from CSV`);
    
    // Group and consolidate durations
    const groupMap = new Map<string, ConsolidatedRow>();
    let processedRows = 0;
    let skippedRows = 0;
    
    for (const row of rows) {
      const groupKey = createGroupKey(row);
      const durationSec = durationToSeconds(row['work/cycles/duration']);
      
      if (durationSec === 0) {
        skippedRows++;
        continue;
      }
      
      if (groupMap.has(groupKey)) {
        // Add to existing group
        const existing = groupMap.get(groupKey)!;
        existing.duration_sec += durationSec;
      } else {
        // Create new group
        groupMap.set(groupKey, {
          'work/rec_name': row['work/rec_name'],
          'work/cycles/operator/rec_name': row['work/cycles/operator/rec_name'],
          'work/cycles/work_center/category/name': row['work/cycles/work_center/category/name'],
          'work/cycles/work/production/routing/name': row['work/cycles/work/production/routing/name'],
          'work/production/id': row['work/production/id'],
          'work/id': row['work/id'],
          'work/production/create_date': row['work/production/create_date'],
          'work/production/quantity_done': row['work/production/quantity_done'],
          duration_sec: durationSec
        });
      }
      
      processedRows++;
    }
    
    // Convert to array and save
    const consolidatedData = Array.from(groupMap.values());
    const csvOutput = stringify(consolidatedData, {
      header: true,
      columns: Object.keys(consolidatedData[0] || {})
    });
    
    writeFileSync(outputFile, csvOutput);
    
    console.log(`✅ Consolidation complete!`);
    console.log(`📊 Original rows: ${rows.length}`);
    console.log(`📊 Processed rows: ${processedRows}`);
    console.log(`📊 Skipped rows (no duration): ${skippedRows}`);
    console.log(`📊 Consolidated groups: ${consolidatedData.length}`);
    console.log(`📊 Compression ratio: ${((1 - consolidatedData.length / rows.length) * 100).toFixed(1)}%`);
    console.log(`💾 Output saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('❌ Error during consolidation:', error);
    throw error;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const inputFile = process.argv[2] || 'cycles-appended.csv';
  const outputFile = process.argv[3] || 'consolidated_cycles.csv';
  
  consolidateDurations(inputFile, outputFile)
    .then(() => {
      console.log('🎉 Duration consolidation completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Duration consolidation failed:', error);
      process.exit(1);
    });
}