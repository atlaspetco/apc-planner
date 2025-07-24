import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { db } from './db.js';
import { sql } from 'drizzle-orm';

/**
 * SIMPLIFIED AUTHENTIC WORK CYCLES IMPORT
 * Focus: Import 32,000 authentic work cycles with correct HH:MM:SS duration parsing
 * Target: Fix fundamental UPH calculation to use same work center durations only
 */

function parseHHMMSSDuration(durationStr: string): number {
  if (!durationStr) return 0;
  
  // Handle formats like "6:34", "3:01:07", "0:29:24"
  const parts = durationStr.split(':').map(p => parseInt(p, 10));
  
  if (parts.length === 2) {
    // MM:SS format
    return (parts[0] * 60) + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  
  return 0;
}

async function importAuthenticWorkCycles(): Promise<void> {
  console.log("🚀 IMPORTING AUTHENTIC WORK CYCLES");
  
  const csvPath = './attached_assets/Work Cycles - cycles w_id_1751614823980.csv';
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, { 
    columns: true, 
    skip_empty_lines: true 
  });
  
  console.log(`📊 Processing ${records.length} CSV records`);
  
  // Clear existing work cycles
  await db.execute(sql`DELETE FROM work_cycles`);
  console.log("🗑️  Cleared existing work cycles");
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    
    try {
      // Parse duration correctly from HH:MM:SS format
      const durationStr = row['work_cycles_duration'];
      const durationSeconds = parseHHMMSSDuration(durationStr);
      
      if (durationSeconds <= 0) {
        console.log(`⚠️  Skipping row ${i}: Invalid duration "${durationStr}"`);
        continue;
      }
      
      // Insert with basic required fields
      await db.execute(sql`
        INSERT INTO work_cycles (
          work_cycles_id,
          work_cycles_rec_name,
          work_cycles_operator_rec_name,
          work_cycles_work_center_rec_name,
          work_production_number,
          work_production_quantity,
          work_production_routing_rec_name,
          work_operation_rec_name,
          work_cycles_duration,
          data_corrupted
        ) VALUES (
          ${parseInt(row['work_cycles_id']) || null},
          ${row['work_cycles_rec_name'] || null},
          ${row['work_cycles_operator_rec_name'] || null},
          ${row['work_cycles_work_center_rec_name'] || null},
          ${row['work_production_number'] || null},
          ${parseInt(row['work_production_quantity']) || null},
          ${row['work_production_routing_rec_name'] || null},
          ${row['work_operation_rec_name'] || null},
          ${durationSeconds},
          FALSE
        )
      `);
      
      successCount++;
      
      if (successCount % 1000 === 0) {
        console.log(`✅ Imported ${successCount} work cycles...`);
      }
      
    } catch (error) {
      errorCount++;
      if (errorCount < 10) {
        console.log(`❌ Error importing row ${i}: ${error}`);
      }
    }
  }
  
  console.log(`\n🎯 IMPORT COMPLETE:`);
  console.log(`   Successfully imported: ${successCount} work cycles`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Duration parsing: HH:MM:SS format correctly handled`);
}

async function verifyMO23577Import(): Promise<void> {
  console.log("\n🔍 VERIFYING MO23577 IMPORT");
  
  const mo23577Results = await db.execute(sql`
    SELECT 
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center,
      work_production_quantity as quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count
    FROM work_cycles 
    WHERE work_production_number = 'MO23577'
    GROUP BY 
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_quantity
    ORDER BY work_cycles_work_center_rec_name
  `);
  
  console.log(`📋 MO23577 Work Center Breakdown:`);
  
  for (const row of mo23577Results.rows) {
    const operatorName = row.operator_name as string;
    const workCenter = row.work_center as string;
    const quantity = row.quantity as number;
    const durationSeconds = row.total_duration_seconds as number;
    const cycleCount = row.cycle_count as number;
    
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const hours = durationSeconds / 3600;
    const uph = quantity / hours;
    
    console.log(`   ${workCenter}: ${operatorName}`);
    console.log(`     Quantity: ${quantity} units`);
    console.log(`     Duration: ${durationSeconds}s (${minutes}m ${seconds}s)`);
    console.log(`     UPH: ${uph.toFixed(2)} units/hour`);
    console.log(``);
  }
}

async function main() {
  try {
    console.log("🎯 STARTING AUTHENTIC WORK CYCLES IMPORT\n");
    
    // Import authentic work cycles
    await importAuthenticWorkCycles();
    
    // Verify specific MO
    await verifyMO23577Import();
    
    console.log("\n✅ AUTHENTIC IMPORT COMPLETE - Ready for same-work-center UPH calculations");
    
  } catch (error) {
    console.error("❌ Import failed:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importAuthenticWorkCycles, parseHHMMSSDuration };