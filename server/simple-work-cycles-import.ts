import fs from 'fs';
import { db } from './db.js';
import { sql } from 'drizzle-orm';

/**
 * SIMPLE WORK CYCLES IMPORT WITHOUT CSV DEPENDENCY
 * Parse CSV manually and import essential data with HH:MM:SS duration parsing
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

function parseCSV(content: string): any[] {
  const lines = content.split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const records = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',').map(v => v.replace(/"/g, '').trim());
    const record: any = {};
    
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    
    records.push(record);
  }
  
  return records;
}

async function importEssentialWorkCycles(): Promise<void> {
  console.log("🚀 IMPORTING ESSENTIAL WORK CYCLES DATA");
  
  const csvPath = './attached_assets/Work Cycles - cycles w_id_1751614823980.csv';
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(csvContent);
  
  console.log(`📊 Processing ${records.length} CSV records`);
  
  // Count existing work cycles
  const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM work_cycles`);
  const existingCount = countResult.rows[0].count as number;
  console.log(`📋 Existing work cycles: ${existingCount}`);
  
  let successCount = 0;
  let errorCount = 0;
  
  // Process in batches to avoid memory issues
  const batchSize = 100;
  
  for (let batchStart = 0; batchStart < records.length; batchStart += batchSize) {
    const batch = records.slice(batchStart, batchStart + batchSize);
    
    for (const row of batch) {
      try {
        // Parse duration correctly from HH:MM:SS format using ACTUAL field names
        const durationStr = row['work/cycles/duration'];
        const durationSeconds = parseHHMMSSDuration(durationStr);
        
        if (durationSeconds <= 0) {
          continue; // Skip invalid durations
        }
        
        // Extract essential fields using ACTUAL CSV field names
        const workCyclesId = parseInt(row['id']) || null;
        const operatorName = row['work/cycles/operator/rec_name'] || null;
        const workCenter = row['work/cycles/work_center/rec_name'] || null;
        const moNumber = row['work/production/number'] || null;
        const quantity = parseInt(row['work/cycles/quantity_done']) || null;
        const routing = row['work/production/routing/rec_name'] || null;
        const operation = row['work/operation/rec_name'] || null;
        
        if (!operatorName || !workCenter || !moNumber) {
          continue; // Skip incomplete records
        }
        
        // Insert with error handling
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
            ${workCyclesId},
            ${row['work/cycles/rec_name'] || null},
            ${operatorName},
            ${workCenter},
            ${moNumber},
            ${quantity},
            ${routing},
            ${operation},
            ${durationSeconds},
            FALSE
          )

        `);
        
        successCount++;
        
      } catch (error) {
        errorCount++;
        if (errorCount < 5) {
          console.log(`❌ Error importing row: ${error}`);
        }
      }
    }
    
    if (batchStart % 1000 === 0) {
      console.log(`✅ Processed ${batchStart + batch.length} records...`);
    }
  }
  
  console.log(`\n🎯 IMPORT COMPLETE:`);
  console.log(`   Successfully imported: ${successCount} work cycles`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Duration parsing: HH:MM:SS format handled`);
}

async function verifyImportResults(): Promise<void> {
  console.log("\n🔍 VERIFYING IMPORT RESULTS");
  
  // Total count
  const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM work_cycles`);
  const totalCount = totalResult.rows[0].count as number;
  console.log(`📊 Total work cycles: ${totalCount}`);
  
  // Sample MO check
  const sampleResults = await db.execute(sql`
    SELECT 
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_number,
      work_production_quantity,
      COUNT(*) as cycle_count,
      SUM(work_cycles_duration) as total_duration
    FROM work_cycles 
    WHERE work_production_number IN ('MO23577', 'MO94699', 'MO21262')
    GROUP BY 
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_number,
      work_production_quantity
    ORDER BY work_production_number, work_cycles_work_center_rec_name
    LIMIT 10
  `);
  
  console.log(`📋 Sample MO data:`);
  for (const row of sampleResults.rows) {
    const operator = row.work_cycles_operator_rec_name as string;
    const workCenter = row.work_cycles_work_center_rec_name as string;
    const moNumber = row.work_production_number as string;
    const quantity = row.work_production_quantity as number;
    const cycleCount = row.cycle_count as number;
    const totalDuration = row.total_duration as number;
    
    const hours = totalDuration / 3600;
    const uph = quantity / hours;
    
    console.log(`   ${moNumber}: ${operator} | ${workCenter}`);
    console.log(`     Quantity: ${quantity}, Duration: ${totalDuration}s (${hours.toFixed(2)}h), UPH: ${uph.toFixed(2)}`);
  }
}

async function main() {
  try {
    console.log("🎯 STARTING SIMPLE WORK CYCLES IMPORT\n");
    
    // Import work cycles
    await importEssentialWorkCycles();
    
    // Verify results
    await verifyImportResults();
    
    console.log("\n✅ READY FOR UPH CALCULATIONS WITH AUTHENTIC DATA");
    
  } catch (error) {
    console.error("❌ Import failed:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importEssentialWorkCycles, parseHHMMSSDuration };