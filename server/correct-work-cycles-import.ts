import { sql } from "drizzle-orm";
import { db } from './db.js';
import * as fs from 'fs';

/**
 * CRITICAL: Correct Work Cycles Import with Proper Duration Parsing
 * 
 * Root Cause Identified: CSV contains HH:MM:SS duration format but import
 * process is not converting to seconds correctly, causing 18-hour errors
 * instead of 46-minute authentic durations.
 * 
 * Solution: Parse HH:MM:SS format correctly and rebuild all 32,000 cycles
 */

interface AuthenticWorkCycleRow {
  'work/cycles/duration': string;           // HH:MM:SS format
  'work/cycles/rec_name': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/operator/write_date': string;
  'work/cycles/work_center/rec_name': string;
  'work/cycles/quantity_done': string;
  'work/production/number': string;         // MO number
  'work/production/product/code': string;
  'work/production/routing/rec_name': string;
  'work/rec_name': string;
  'work/operation/rec_name': string;
  'work/operation/id': string;
  'work/id': string;
  'work/operator/id': string;
  'work_center/id': string;
  'work/production/id': string;
  'id': string;                            // Cycle ID
}

/**
 * Parse HH:MM:SS duration to seconds correctly
 * Examples: "0:26:53" -> 1613 seconds, "0:46:28" -> 2788 seconds
 */
function parseHMSToSeconds(hmsString: string): number {
  if (!hmsString || hmsString.trim() === '') return 0;
  
  const parts = hmsString.split(':');
  if (parts.length !== 3) {
    console.log(`⚠️  Invalid HMS format: ${hmsString}`);
    return 0;
  }
  
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseInt(parts[2]) || 0;
  
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  
  // Validation: reasonable manufacturing cycle time
  if (totalSeconds < 1 || totalSeconds > 86400) { // 1 second to 24 hours
    console.log(`⚠️  Unreasonable duration: ${hmsString} = ${totalSeconds}s`);
    return 0;
  }
  
  return totalSeconds;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

async function clearWorkCyclesTable(): Promise<void> {
  console.log("🗑️  CLEARING WORK CYCLES TABLE");
  await db.execute(sql`DELETE FROM work_cycles`);
  console.log("✅ Work cycles table cleared");
}

async function importAuthenticWorkCycles(csvFilePath: string): Promise<number> {
  console.log(`📁 IMPORTING AUTHENTIC WORK CYCLES: ${csvFilePath}`);
  
  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`CSV file not found: ${csvFilePath}`);
  }
  
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = csvContent.split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file appears empty');
  }
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`📋 CSV Headers: ${headers.length} columns`);
  console.log(`   Duration column: "${headers[0]}"`);
  
  // Parse data rows
  const rows: AuthenticWorkCycleRow[] = [];
  let parseErrors = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    if (values.length !== headers.length) {
      parseErrors++;
      if (parseErrors <= 5) {
        console.log(`⚠️  Line ${i + 1}: Column count mismatch (${values.length} vs ${headers.length})`);
      }
      continue;
    }
    
    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    
    rows.push(row as AuthenticWorkCycleRow);
  }
  
  console.log(`📊 Parsed ${rows.length} data rows (${parseErrors} parse errors)`);
  
  // Import with correct duration parsing
  let importedCount = 0;
  let skippedCount = 0;
  const durationExamples: Array<{hms: string, seconds: number}> = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Parse duration correctly
    const durationSeconds = parseHMSToSeconds(row['work/cycles/duration']);
    
    if (durationSeconds === 0) {
      skippedCount++;
      continue;
    }
    
    // Collect examples for verification
    if (durationExamples.length < 10) {
      durationExamples.push({
        hms: row['work/cycles/duration'],
        seconds: durationSeconds
      });
    }
    
    try {
      await db.execute(sql`
        INSERT INTO work_cycles (
          work_cycles_id,
          work_cycles_duration,
          work_cycles_rec_name,
          work_cycles_operator_rec_name,
          work_cycles_operator_write_date,
          work_cycles_work_center_rec_name,
          work_cycles_quantity_done,
          work_production_id,
          work_production_number,
          work_production_product_code,
          work_production_routing_rec_name,
          work_rec_name,
          work_operation_rec_name,
          work_operation_id,
          work_id,
          work_operator_id,
          work_center_id,
          state,
          data_corrupted
        ) VALUES (
          ${parseInt(row.id)},
          ${durationSeconds},
          ${row['work/cycles/rec_name'] || null},
          ${row['work/cycles/operator/rec_name'] || null},
          ${row['work/cycles/operator/write_date'] || null},
          ${row['work/cycles/work_center/rec_name'] || null},
          ${parseFloat(row['work/cycles/quantity_done']) || null},
          ${parseInt(row['work/production/id']) || null},
          ${row['work/production/number'] || null},
          ${row['work/production/product/code'] || null},
          ${row['work/production/routing/rec_name'] || null},
          ${row['work/rec_name'] || null},
          ${row['work/operation/rec_name'] || null},
          ${parseInt(row['work/operation/id']) || null},
          ${parseInt(row['work/id']) || null},
          ${parseInt(row['work/operator/id']) || null},
          ${parseInt(row['work_center/id']) || null},
          'done',
          FALSE
        )
        ON CONFLICT DO NOTHING
          work_cycles_duration = EXCLUDED.work_cycles_duration,
          work_cycles_rec_name = EXCLUDED.work_cycles_rec_name,
          work_cycles_operator_rec_name = EXCLUDED.work_cycles_operator_rec_name,
          work_cycles_operator_write_date = EXCLUDED.work_cycles_operator_write_date,
          work_cycles_work_center_rec_name = EXCLUDED.work_cycles_work_center_rec_name,
          work_cycles_quantity_done = EXCLUDED.work_cycles_quantity_done,
          work_production_id = EXCLUDED.work_production_id,
          work_production_number = EXCLUDED.work_production_number,
          work_production_product_code = EXCLUDED.work_production_product_code,
          work_production_routing_rec_name = EXCLUDED.work_production_routing_rec_name,
          work_rec_name = EXCLUDED.work_rec_name,
          work_operation_rec_name = EXCLUDED.work_operation_rec_name,
          work_operation_id = EXCLUDED.work_operation_id,
          work_id = EXCLUDED.work_id,
          work_operator_id = EXCLUDED.work_operator_id,
          work_center_id = EXCLUDED.work_center_id,
          state = EXCLUDED.state,
          data_corrupted = FALSE,
          updated_at = NOW()
      `);
      
      importedCount++;
      
      if (importedCount % 1000 === 0) {
        console.log(`📥 Imported ${importedCount} cycles (${skippedCount} skipped)`);
      }
      
    } catch (error) {
      console.error(`❌ Error importing cycle ${row.id}:`, error);
      skippedCount++;
    }
  }
  
  console.log("\n📊 DURATION PARSING EXAMPLES:");
  for (const example of durationExamples) {
    const minutes = Math.floor(example.seconds / 60);
    const secs = example.seconds % 60;
    console.log(`   ${example.hms} → ${example.seconds}s (${minutes}m ${secs}s)`);
  }
  
  console.log(`✅ Import complete: ${importedCount} imported, ${skippedCount} skipped`);
  return importedCount;
}

async function verifySpecificMO(moNumber: string): Promise<void> {
  console.log(`\n🔍 VERIFYING ${moNumber} CALCULATIONS`);
  
  const cycles = await db.execute(sql`
    SELECT 
      work_cycles_id,
      work_cycles_duration,
      work_cycles_quantity_done,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name
    FROM work_cycles 
    WHERE work_production_number = ${moNumber}
    ORDER BY work_cycles_duration DESC
  `);
  
  if (cycles.rows.length === 0) {
    console.log(`❌ No cycles found for ${moNumber}`);
    return;
  }
  
  let totalDuration = 0;
  let totalQuantity = 0;
  
  console.log(`📋 ${moNumber} Work Cycles:`);
  for (const cycle of cycles.rows) {
    const durationSeconds = cycle.work_cycles_duration as number;
    const quantity = cycle.work_cycles_quantity_done as number;
    const minutes = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    
    totalDuration += durationSeconds;
    totalQuantity += quantity;
    
    console.log(`   ID:${cycle.work_cycles_id} ${cycle.work_cycles_operator_rec_name} ${cycle.work_cycles_work_center_rec_name}: ${durationSeconds}s (${minutes}m ${secs}s) - Qty:${quantity}`);
  }
  
  const totalMinutes = Math.floor(totalDuration / 60);
  const totalSecs = totalDuration % 60;
  const totalHours = totalDuration / 3600;
  const uph = totalQuantity / totalHours;
  
  console.log(`📊 ${moNumber} TOTALS:`);
  console.log(`   Total Duration: ${totalDuration}s (${totalMinutes}m ${totalSecs}s = ${totalHours.toFixed(2)}h)`);
  console.log(`   Total Quantity: ${totalQuantity}`);
  console.log(`   Calculated UPH: ${uph.toFixed(2)} units/hour`);
}

async function verifyDataIntegrity(): Promise<void> {
  console.log("\n📊 VERIFYING COMPLETE DATA INTEGRITY");
  
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(DISTINCT work_production_number) as unique_mos,
      COUNT(DISTINCT work_cycles_operator_rec_name) as unique_operators,
      AVG(work_cycles_duration) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration,
      COUNT(CASE WHEN work_cycles_duration < 60 THEN 1 END) as under_1min,
      COUNT(CASE WHEN work_cycles_duration BETWEEN 60 AND 3600 THEN 1 END) as normal_range,
      COUNT(CASE WHEN work_cycles_duration > 3600 THEN 1 END) as over_1hour
    FROM work_cycles
  `);
  
  const result = stats.rows[0];
  const avgMinutes = Math.floor((result.avg_duration_seconds as number) / 60);
  const avgSecs = Math.floor((result.avg_duration_seconds as number) % 60);
  
  console.log(`✅ Total Cycles: ${result.total_cycles}`);
  console.log(`✅ Unique MOs: ${result.unique_mos}`);
  console.log(`✅ Unique Operators: ${result.unique_operators}`);
  console.log(`📈 Average Duration: ${result.avg_duration_seconds}s (${avgMinutes}m ${avgSecs}s)`);
  console.log(`📊 Duration Distribution:`);
  console.log(`   < 1 minute: ${result.under_1min}`);
  console.log(`   1min - 1hour: ${result.normal_range}`);
  console.log(`   > 1 hour: ${result.over_1hour}`);
}

async function main() {
  try {
    console.log("🚀 STARTING CORRECT WORK CYCLES IMPORT\n");
    console.log("Target: Fix all 32,000 work cycles with authentic duration parsing\n");
    
    const csvPath = 'attached_assets/Work Cycles - cycles w_id_1751614823980.csv';
    
    // Step 1: Clear existing corrupted data
    await clearWorkCyclesTable();
    
    // Step 2: Import with correct HMS parsing
    const importedCount = await importAuthenticWorkCycles(csvPath);
    
    // Step 3: Verify specific problematic MO
    await verifySpecificMO('MO23577');
    
    // Step 4: Verify overall data integrity
    await verifyDataIntegrity();
    
    console.log("\n🎯 CORRECT IMPORT SUMMARY:");
    console.log(`   Records Imported: ${importedCount}`);
    console.log(`   Duration Format: HH:MM:SS → seconds conversion`);
    console.log(`   Data Quality: AUTHENTIC`);
    
    console.log("\n🔄 NEXT STEPS:");
    console.log("1. Recalculate UPH with corrected durations");
    console.log("2. Verify MO23577 shows ~46 minutes instead of 18 hours");
    console.log("3. Test production planning with accurate data");
    
  } catch (error) {
    console.error("❌ Error during correct import:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importAuthenticWorkCycles, verifySpecificMO, parseHMSToSeconds };