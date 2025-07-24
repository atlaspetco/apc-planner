import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { db } from './server/db';
import { workCyclesConsolidated, operatorUph } from './shared/schema';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CsvRow {
  'work/cycles/operator/write_date': string;
  'work/production/create_date': string;
  'work/production/id': string;
  'work/rec_name': string;
  'production_work_number+Operation_rec_name+production_number': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/work_center/category/name': string;
  'work/operation/rec_name': string;
  'work/cycles/quantity_done': string;
  'work/production/quantity_done': string;
  'work/cycles/duration_sec': string;
  'work/cycles/duration': string;
  'work/cycles/rec_name': string; // Column O: operator+operation+work_center
  'work/cycles/work_center/rec_name': string;
  'work/cycles/work/production/routing/name': string; // Column Q: routing
  'work/production/routing/rec_name': string;
  'work/production/number': string;
}

// Convert HH:MM:SS to seconds
function durationToSeconds(duration: string): number {
  if (!duration || duration.trim() === '') return 0;
  
  // If already in seconds format
  if (!duration.includes(':')) {
    return parseInt(duration) || 0;
  }
  
  const parts = duration.split(':');
  if (parts.length !== 3) return 0;
  
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseInt(parts[2]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

async function consolidateAndCalculateUph() {
  try {
    console.log('🧹 Step 1: Clearing existing data...');
    await db.delete(workCyclesConsolidated);
    await db.delete(operatorUph);
    console.log('✅ Cleared existing data from both tables');

    console.log('\n📁 Step 2: Loading CSV file...');
    const csvPath = path.join(__dirname, 'attached_assets', 'cycles-appended_1753386052631.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const rows: CsvRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    console.log(`✅ Loaded ${rows.length} rows from CSV`);

    // Step 3: Consolidate work cycles
    console.log('\n🔄 Step 3: Consolidating work cycles...');
    const consolidationMap = new Map<string, {
      work_production_id: number;
      consolidation_key: string;
      total_duration_sec: number;
      quantity_done: number | null;
      first_populated_row: CsvRow | null;
      has_populated_row: boolean;
    }>();

    let skippedRows = 0;
    let processedRows = 0;

    for (const row of rows) {
      const productionId = row['work/production/id'];
      const consolidationKey = row['production_work_number+Operation_rec_name+production_number'];
      
      // Skip rows without key fields
      if (!productionId || !consolidationKey) {
        skippedRows++;
        continue;
      }

      const key = `${productionId}|${consolidationKey}`;
      const duration = durationToSeconds(row['work/cycles/duration']);
      const quantity = parseFloat(row['work/cycles/quantity_done']) || 0;
      
      // Check if this is a fully populated row
      const isPopulated = productionId && quantity > 0;

      if (!consolidationMap.has(key)) {
        consolidationMap.set(key, {
          work_production_id: parseInt(productionId),
          consolidation_key: consolidationKey,
          total_duration_sec: duration,
          quantity_done: isPopulated ? quantity : null,
          first_populated_row: isPopulated ? row : null,
          has_populated_row: isPopulated,
        });
      } else {
        const existing = consolidationMap.get(key)!;
        // Always sum durations
        existing.total_duration_sec += duration;
        
        // Only update quantity from first populated row
        if (isPopulated && !existing.has_populated_row) {
          existing.quantity_done = quantity;
          existing.first_populated_row = row;
          existing.has_populated_row = true;
        }
      }
      processedRows++;
    }

    console.log(`✅ Processed ${processedRows} rows, skipped ${skippedRows} rows`);
    console.log(`✅ Created ${consolidationMap.size} consolidated entries`);

    // Insert consolidated data
    console.log('\n💾 Inserting consolidated data...');
    const consolidatedRecords = [];
    for (const [_, data] of consolidationMap) {
      if (!data.quantity_done || data.total_duration_sec === 0) {
        continue; // Skip entries without quantity or duration
      }

      const record = {
        work_production_id: data.work_production_id,
        production_work_operation_key: data.consolidation_key, // Same as consolidation_key
        consolidation_key: data.consolidation_key,
        total_duration_sec: data.total_duration_sec,
        quantity_done: data.quantity_done,
        operator_write_date: data.first_populated_row?.['work/cycles/operator/write_date'] 
          ? new Date(data.first_populated_row['work/cycles/operator/write_date']) 
          : null,
        operator_rec_name: data.first_populated_row?.['work/cycles/operator/rec_name'] || null,
        work_center_category_name: data.first_populated_row?.['work/cycles/work_center/category/name'] || null,
        cycles_rec_name: data.first_populated_row?.['work/cycles/rec_name'] || null,
        routing_name: data.first_populated_row?.['work/cycles/work/production/routing/name'] || null,
      };
      consolidatedRecords.push(record);
    }

    if (consolidatedRecords.length > 0) {
      // Insert in batches to avoid stack overflow
      const batchSize = 1000;
      for (let i = 0; i < consolidatedRecords.length; i += batchSize) {
        const batch = consolidatedRecords.slice(i, i + batchSize);
        await db.insert(workCyclesConsolidated).values(batch);
        console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(consolidatedRecords.length / batchSize)} (${batch.length} records)`);
      }
      console.log(`✅ Inserted ${consolidatedRecords.length} consolidated records`);
    }

    // Step 4: Calculate UPH by operator+operation+work_center and routing
    console.log('\n📊 Step 4: Calculating UPH...');
    const uphMap = new Map<string, {
      operator_operation_workcenter: string;
      routing_name: string;
      total_quantity: number;
      total_duration_sec: number;
      observation_count: number;
    }>();

    // Process all rows for UPH calculation (not just consolidated)
    for (const row of rows) {
      const operatorOpWorkCenter = row['work/cycles/rec_name']; // Column O
      const routing = row['work/cycles/work/production/routing/name']; // Column Q
      const quantity = parseFloat(row['work/cycles/quantity_done']) || 0;
      const duration = durationToSeconds(row['work/cycles/duration']);

      // Skip rows without required fields
      if (!operatorOpWorkCenter || !routing || quantity === 0 || duration === 0) {
        continue;
      }

      const key = `${operatorOpWorkCenter}|${routing}`;
      
      if (!uphMap.has(key)) {
        uphMap.set(key, {
          operator_operation_workcenter: operatorOpWorkCenter,
          routing_name: routing,
          total_quantity: quantity,
          total_duration_sec: duration,
          observation_count: 1,
        });
      } else {
        const existing = uphMap.get(key)!;
        existing.total_quantity += quantity;
        existing.total_duration_sec += duration;
        existing.observation_count += 1;
      }
    }

    console.log(`✅ Created ${uphMap.size} UPH combinations`);

    // Insert UPH data
    console.log('\n💾 Inserting UPH data...');
    const uphRecords = [];
    for (const [_, data] of uphMap) {
      const totalHours = data.total_duration_sec / 3600;
      if (totalHours === 0) continue;

      const uph = data.total_quantity / totalHours;
      
      uphRecords.push({
        operator_operation_workcenter: data.operator_operation_workcenter,
        routing_name: data.routing_name,
        total_quantity: data.total_quantity,
        total_duration_hours: totalHours,
        uph: uph,
        observation_count: data.observation_count,
      });
    }

    if (uphRecords.length > 0) {
      // Insert in batches to avoid stack overflow
      const batchSize = 1000;
      for (let i = 0; i < uphRecords.length; i += batchSize) {
        const batch = uphRecords.slice(i, i + batchSize);
        await db.insert(operatorUph).values(batch);
        console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uphRecords.length / batchSize)} (${batch.length} records)`);
      }
      console.log(`✅ Inserted ${uphRecords.length} UPH records`);
    }

    // Display summary
    console.log('\n📈 Summary:');
    console.log(`- Total CSV rows: ${rows.length}`);
    console.log(`- Consolidated work cycles: ${consolidatedRecords.length}`);
    console.log(`- Unique UPH combinations: ${uphRecords.length}`);
    
    // Show sample UPH results
    if (uphRecords.length > 0) {
      console.log('\n🎯 Sample UPH results:');
      uphRecords.slice(0, 10).forEach(record => {
        console.log(`  ${record.operator_operation_workcenter} | ${record.routing_name}: ${record.uph.toFixed(2)} UPH (${record.observation_count} observations)`);
      });
    }

    console.log('\n✅ Consolidation and UPH calculation complete!');

  } catch (error) {
    console.error('❌ Error during consolidation:', error);
    process.exit(1);
  }
}

// Run the consolidation
consolidateAndCalculateUph().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});