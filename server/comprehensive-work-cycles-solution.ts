import { db } from './db.js';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

/**
 * Comprehensive Work Cycles Import and UPH Calculation Solution
 * 
 * This implements the exact UPH calculation logic:
 * 1. Import all 32,000 work cycles with correct duration parsing
 * 2. Group by MO + Work Center Category
 * 3. Sum durations and convert to hours
 * 4. Calculate UPH = Production Quantity / Total Hours
 * 5. Average UPH by Operator + Work Center Category + Routing + Operation
 */

// Work Center Category Mapping
function getWorkCenterCategory(workCenter: string): string {
  if (!workCenter) return 'Unknown';
  
  const wcLower = workCenter.toLowerCase();
  
  // Rope & Sewing → Assembly
  if (wcLower.includes('rope') || wcLower.includes('sewing')) {
    return 'Assembly';
  }
  
  // Cutting → Cutting
  if (wcLower.includes('cutting')) {
    return 'Cutting';
  }
  
  // Packaging → Packaging
  if (wcLower.includes('packaging')) {
    return 'Packaging';
  }
  
  // Assembly → Assembly
  if (wcLower.includes('assembly')) {
    return 'Assembly';
  }
  
  return workCenter;
}

// Parse HH:MM:SS duration to seconds
function parseHMSToSeconds(hmsString: string): number {
  if (!hmsString || hmsString.trim() === '') return 0;
  
  const parts = hmsString.split(':');
  if (parts.length !== 3) return 0;
  
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseInt(parts[2]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Parse CSV line handling quoted values
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

async function importCSVWorkCycles() {
  console.log("📁 Importing work cycles from CSV with correct duration parsing...");
  
  const csvPath = 'attached_assets/Work Cycles - cycles w_id_1751614823980.csv';
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  // Clear existing data
  await db.execute(sql`DELETE FROM work_cycles`);
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');
  
  const headers = parseCSVLine(lines[0]);
  console.log(`📋 Found ${headers.length} columns`);
  
  let importedCount = 0;
  let errorCount = 0;
  const sampleDurations: Array<{hms: string, seconds: number, mo: string}> = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      const values = parseCSVLine(line);
      if (values.length !== headers.length) continue;
      
      const row: any = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j];
      }
      
      // Parse duration
      const durationSeconds = parseHMSToSeconds(row['work/cycles/duration']);
      if (durationSeconds <= 0) continue;
      
      // Parse numeric fields with validation
      const cycleId = row.id ? parseInt(row.id) : null;
      const workId = row['work/id'] ? parseInt(row['work/id']) : null;
      const productionId = row['work/production/id'] ? parseInt(row['work/production/id']) : null;
      const operationId = row['work/operation/id'] ? parseInt(row['work/operation/id']) : null;
      const operatorId = row['work/operator/id'] ? parseInt(row['work/operator/id']) : null;
      const workCenterId = row['work_center/id'] ? parseInt(row['work_center/id']) : null;
      const quantityDone = row['work/cycles/quantity_done'] ? parseFloat(row['work/cycles/quantity_done']) : 0;
      
      // Skip if essential IDs are missing
      if (!cycleId || !workId) continue;
      
      // Map work center to category
      const originalWorkCenter = row['work/cycles/work_center/rec_name'] || '';
      const workCenterCategory = getWorkCenterCategory(originalWorkCenter);
      
      // Collect sample durations
      if (sampleDurations.length < 5 && row['work/production/number'] === 'MO23577') {
        sampleDurations.push({
          hms: row['work/cycles/duration'],
          seconds: durationSeconds,
          mo: row['work/production/number']
        });
      }
      
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
          ${cycleId},
          ${durationSeconds},
          ${row['work/cycles/rec_name'] || null},
          ${row['work/cycles/operator/rec_name'] || null},
          ${row['work/cycles/operator/write_date'] || null},
          ${workCenterCategory},
          ${quantityDone},
          ${productionId},
          ${row['work/production/number'] || null},
          ${row['work/production/product/code'] || null},
          ${row['work/production/routing/rec_name'] || null},
          ${row['work/rec_name'] || null},
          ${row['work/operation/rec_name'] || null},
          ${operationId},
          ${workId},
          ${operatorId},
          ${workCenterId},
          'done',
          FALSE
        )
        ON CONFLICT DO NOTHING
      `);
      
      importedCount++;
      
      if (importedCount % 1000 === 0) {
        console.log(`📥 Imported ${importedCount} cycles...`);
      }
      
    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`Error on line ${i + 1}:`, error);
      }
    }
  }
  
  console.log(`\n✅ Import complete: ${importedCount} imported, ${errorCount} errors`);
  
  if (sampleDurations.length > 0) {
    console.log("\n📊 MO23577 Duration Parsing Examples:");
    for (const sample of sampleDurations) {
      const hours = sample.seconds / 3600;
      console.log(`   ${sample.hms} → ${sample.seconds}s (${hours.toFixed(2)}h)`);
    }
  }
  
  return importedCount;
}

async function calculateUPH() {
  console.log("\n🧮 Calculating UPH with proper methodology...");
  
  // Step 1: Group work cycles by MO + Work Center Category
  const moWorkCenterGroups = await db.execute(sql`
    SELECT 
      work_production_number as mo_number,
      work_cycles_work_center_rec_name as work_center,
      work_cycles_operator_rec_name as operator_name,
      work_production_routing_rec_name as routing,
      work_operation_rec_name as operation,
      SUM(work_cycles_duration) as total_duration_seconds,
      MAX(work_cycles_quantity_done) as production_quantity,
      COUNT(*) as cycle_count
    FROM work_cycles
    WHERE 
      work_cycles_duration > 0
      AND work_production_number IS NOT NULL
      AND work_cycles_operator_rec_name IS NOT NULL
      AND data_corrupted = FALSE
    GROUP BY 
      work_production_number,
      work_cycles_work_center_rec_name,
      work_cycles_operator_rec_name,
      work_production_routing_rec_name,
      work_operation_rec_name
  `);
  
  console.log(`📊 Found ${moWorkCenterGroups.rows.length} MO/WorkCenter/Operator groups`);
  
  // Step 2: Calculate UPH for each group
  const uphResults = new Map<string, {
    values: number[];
    totalQuantity: number;
    totalHours: number;
    operator: string;
    workCenter: string;
    routing: string;
    operation: string;
  }>();
  
  for (const row of moWorkCenterGroups.rows) {
    const totalHours = (row.total_duration_seconds as number) / 3600;
    const quantity = row.production_quantity as number || 0;
    
    if (totalHours <= 0 || quantity <= 0) continue;
    
    const uph = quantity / totalHours;
    
    // Create key for aggregation
    const key = `${row.operator_name}|${row.work_center}|${row.routing}|${row.operation}`;
    
    if (!uphResults.has(key)) {
      uphResults.set(key, {
        values: [],
        totalQuantity: 0,
        totalHours: 0,
        operator: row.operator_name as string,
        workCenter: row.work_center as string,
        routing: row.routing as string || 'Unknown',
        operation: row.operation as string || 'Unknown'
      });
    }
    
    const result = uphResults.get(key)!;
    result.values.push(uph);
    result.totalQuantity += quantity;
    result.totalHours += totalHours;
  }
  
  // Step 3: Calculate average UPH and save results
  console.log("\n💾 Saving UPH results...");
  
  await db.execute(sql`DELETE FROM uph_data WHERE data_source = 'work_cycles'`);
  
  // Get operator IDs
  const operators = await db.execute(sql`SELECT id, name FROM operators`);
  const operatorMap = new Map(operators.rows.map(op => [op.name as string, op.id as number]));
  
  let savedCount = 0;
  const sampleResults: any[] = [];
  
  for (const [key, result] of uphResults) {
    if (result.values.length === 0) continue;
    
    const averageUPH = result.values.reduce((sum, val) => sum + val, 0) / result.values.length;
    const operatorId = operatorMap.get(result.operator);
    
    if (!operatorId) {
      console.log(`⚠️  No operator ID found for: ${result.operator}`);
      continue;
    }
    
    await db.execute(sql`
      INSERT INTO uph_data (
        operator_id,
        operator_name,
        work_center,
        operation,
        product_routing,
        uph,
        observation_count,
        total_duration_hours,
        total_quantity,
        data_source,
        calculation_period
      ) VALUES (
        ${operatorId},
        ${result.operator},
        ${result.workCenter},
        ${result.operation},
        ${result.routing},
        ${Math.round(averageUPH * 100) / 100},
        ${result.values.length},
        ${Math.round(result.totalHours * 100) / 100},
        ${result.totalQuantity},
        'work_cycles',
        30
      )
    `);
    
    savedCount++;
    
    // Collect samples for display
    if (sampleResults.length < 15) {
      sampleResults.push({
        operator: result.operator,
        workCenter: result.workCenter,
        routing: result.routing,
        operation: result.operation,
        uph: Math.round(averageUPH * 100) / 100,
        moCount: result.values.length
      });
    }
  }
  
  console.log(`\n✅ Saved ${savedCount} UPH records`);
  
  // Display sample results by work center
  console.log("\n📊 Sample UPH Results:");
  for (const wc of ['Cutting', 'Assembly', 'Packaging']) {
    const wcResults = sampleResults.filter(r => r.workCenter === wc);
    if (wcResults.length > 0) {
      console.log(`\n${wc}:`);
      for (const r of wcResults.slice(0, 3)) {
        console.log(`  ${r.operator} - ${r.routing} - ${r.operation}: ${r.uph} UPH (${r.moCount} MOs)`);
      }
    }
  }
}

async function verifyMO23577() {
  console.log("\n🔍 Verifying MO23577 calculations...");
  
  const cycles = await db.execute(sql`
    SELECT 
      work_cycles_work_center_rec_name as work_center,
      work_cycles_operator_rec_name as operator,
      COUNT(*) as cycle_count,
      SUM(work_cycles_duration) as total_seconds,
      ROUND(CAST(SUM(work_cycles_duration) / 3600.0 AS NUMERIC), 2) as total_hours
    FROM work_cycles 
    WHERE work_production_number = 'MO23577'
    GROUP BY work_cycles_work_center_rec_name, work_cycles_operator_rec_name
    ORDER BY total_seconds DESC
  `);
  
  let grandTotal = 0;
  console.log("MO23577 Breakdown:");
  for (const row of cycles.rows) {
    console.log(`  ${row.work_center} (${row.operator}): ${row.total_seconds}s = ${row.total_hours}h`);
    grandTotal += (row.total_seconds as number);
  }
  
  const totalHours = grandTotal / 3600;
  console.log(`  TOTAL: ${grandTotal}s = ${totalHours.toFixed(2)}h (should be ~3.6h, not 18h)`);
}

async function main() {
  try {
    console.log("🚀 COMPREHENSIVE WORK CYCLES & UPH SOLUTION\n");
    
    // Import from CSV
    await importCSVWorkCycles();
    
    // Verify specific MO
    await verifyMO23577();
    
    // Calculate UPH
    await calculateUPH();
    
    console.log("\n✅ ALL COMPLETE! Work cycles imported and UPH calculated correctly.");
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importCSVWorkCycles, calculateUPH, verifyMO23577 };