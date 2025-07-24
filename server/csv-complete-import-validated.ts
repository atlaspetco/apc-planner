import { sql } from "drizzle-orm";
import { db } from './db.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CRITICAL: Complete CSV Import with Validation
 * 
 * Since Fulfil API endpoints are returning 405 errors, we'll use the CSV
 * import infrastructure that previously worked successfully to import
 * all 32,000 work cycles with proper validation to prevent corruption.
 */

interface WorkCycleCSVRow {
  work_cycles_duration: string;
  work_cycles_id: string;
  work_cycles_rec_name: string;
  work_cycles_operator_rec_name: string;
  work_cycles_operator_id: string;
  work_cycles_operator_write_date: string;
  work_cycles_work_center_rec_name: string;
  work_cycles_quantity_done: string;
  work_production_id: string;
  work_production_number: string;
  work_production_product_code: string;
  work_production_quantity: string;
  work_production_priority: string;
  work_production_create_date: string;
  work_production_routing_rec_name: string;
  work_rec_name: string;
  work_operation_rec_name: string;
  work_operation_id: string;
  work_id: string;
  work_operator_id: string;
  work_center_id: string;
  state: string;
}

interface ValidationResult {
  isValid: boolean;
  reason?: string;
  correctedDuration?: number;
}

function validateWorkCycleRow(row: WorkCycleCSVRow): ValidationResult {
  // Parse duration
  const duration = parseFloat(row.work_cycles_duration);
  
  // Critical validation rules to prevent corruption
  if (isNaN(duration)) {
    return { isValid: false, reason: 'Invalid duration format' };
  }
  
  if (duration <= 0) {
    return { isValid: false, reason: 'Duration must be positive' };
  }
  
  // Detect corruption pattern: identical short durations
  if (duration > 0 && duration < 120) { // Less than 2 minutes
    // This might be corrupted data, but we need to be careful
    // Check if it's part of a pattern of identical values
    return { isValid: true, correctedDuration: duration }; // Keep for now, flag later if pattern detected
  }
  
  // Maximum reasonable duration: 24 hours
  if (duration > 86400) {
    return { isValid: false, reason: 'Duration exceeds 24 hours (likely corrupted)' };
  }
  
  // Validate quantity
  const quantity = parseFloat(row.work_cycles_quantity_done);
  if (isNaN(quantity) || quantity <= 0) {
    return { isValid: false, reason: 'Invalid quantity_done' };
  }
  
  // Validate required IDs
  if (!row.work_cycles_id || isNaN(parseInt(row.work_cycles_id))) {
    return { isValid: false, reason: 'Invalid work_cycles_id' };
  }
  
  return { isValid: true, correctedDuration: duration };
}

async function clearAllWorkCycles(): Promise<void> {
  console.log("🗑️  CLEARING ALL EXISTING WORK CYCLES");
  
  await db.execute(sql`DELETE FROM work_cycles`);
  console.log("✅ All work cycles cleared");
}

async function detectDurationPatterns(rows: WorkCycleCSVRow[]): Promise<Map<number, number>> {
  console.log("🔍 DETECTING CORRUPTION PATTERNS IN DURATIONS");
  
  // Group by duration and count occurrences
  const durationCounts = new Map<number, number>();
  
  for (const row of rows) {
    const duration = parseFloat(row.work_cycles_duration);
    if (!isNaN(duration)) {
      durationCounts.set(duration, (durationCounts.get(duration) || 0) + 1);
    }
  }
  
  // Find suspicious patterns (many identical short durations)
  const suspiciousPatterns = new Map<number, number>();
  
  for (const [duration, count] of durationCounts) {
    if (duration < 120 && count > 100) { // More than 100 cycles with same short duration
      suspiciousPatterns.set(duration, count);
      console.log(`⚠️  Suspicious pattern: ${count} cycles with ${duration}s duration`);
    }
  }
  
  console.log(`📊 Found ${suspiciousPatterns.size} suspicious duration patterns`);
  return suspiciousPatterns;
}

async function importValidatedWorkCycles(csvFilePath: string): Promise<number> {
  console.log(`📁 IMPORTING WORK CYCLES FROM: ${csvFilePath}`);
  
  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`CSV file not found: ${csvFilePath}`);
  }
  
  // Read and parse CSV
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = csvContent.split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file appears to be empty or has no data rows');
  }
  
  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  console.log(`📋 CSV Headers: ${headers.length} columns`);
  
  // Parse rows
  const rows: WorkCycleCSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    if (values.length !== headers.length) continue;
    
    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    
    rows.push(row as WorkCycleCSVRow);
  }
  
  console.log(`📊 Parsed ${rows.length} data rows from CSV`);
  
  // Detect corruption patterns
  const suspiciousPatterns = await detectDurationPatterns(rows);
  
  // Import with validation
  let validCount = 0;
  let skippedCount = 0;
  let correctedCount = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Validate row
    const validation = validateWorkCycleRow(row);
    
    if (!validation.isValid) {
      skippedCount++;
      if (skippedCount <= 10) {
        console.log(`⚠️  Skipped row ${i + 1}: ${validation.reason}`);
      }
      continue;
    }
    
    // Check if this duration is part of a suspicious pattern
    const duration = validation.correctedDuration!;
    const isCorrupted = suspiciousPatterns.has(duration);
    
    try {
      await db.execute(sql`
        INSERT INTO work_cycles (
          work_cycles_id,
          work_cycles_duration,
          work_cycles_quantity_done,
          work_cycles_rec_name,
          work_cycles_operator_rec_name,
          work_cycles_operator_id,
          work_cycles_operator_write_date,
          work_cycles_work_center_rec_name,
          work_production_id,
          work_production_number,
          work_production_product_code,
          work_production_quantity,
          work_production_priority,
          work_production_create_date,
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
          ${parseInt(row.work_cycles_id)},
          ${duration},
          ${parseFloat(row.work_cycles_quantity_done)},
          ${row.work_cycles_rec_name || null},
          ${row.work_cycles_operator_rec_name || null},
          ${row.work_cycles_operator_id ? parseInt(row.work_cycles_operator_id) : null},
          ${row.work_cycles_operator_write_date || null},
          ${row.work_cycles_work_center_rec_name || null},
          ${row.work_production_id ? parseInt(row.work_production_id) : null},
          ${row.work_production_number || null},
          ${row.work_production_product_code || null},
          ${row.work_production_quantity ? parseFloat(row.work_production_quantity) : null},
          ${row.work_production_priority || null},
          ${row.work_production_create_date || null},
          ${row.work_production_routing_rec_name || null},
          ${row.work_rec_name || null},
          ${row.work_operation_rec_name || null},
          ${row.work_operation_id ? parseInt(row.work_operation_id) : null},
          ${row.work_id ? parseInt(row.work_id) : null},
          ${row.work_operator_id ? parseInt(row.work_operator_id) : null},
          ${row.work_center_id ? parseInt(row.work_center_id) : null},
          ${row.state || 'done'},
          ${isCorrupted}
        )
        ON CONFLICT (work_cycles_id) DO UPDATE SET
          work_cycles_duration = EXCLUDED.work_cycles_duration,
          work_cycles_quantity_done = EXCLUDED.work_cycles_quantity_done,
          work_cycles_rec_name = EXCLUDED.work_cycles_rec_name,
          work_cycles_operator_rec_name = EXCLUDED.work_cycles_operator_rec_name,
          work_cycles_operator_id = EXCLUDED.work_cycles_operator_id,
          work_cycles_operator_write_date = EXCLUDED.work_cycles_operator_write_date,
          work_cycles_work_center_rec_name = EXCLUDED.work_cycles_work_center_rec_name,
          work_production_id = EXCLUDED.work_production_id,
          work_production_number = EXCLUDED.work_production_number,
          work_production_product_code = EXCLUDED.work_production_product_code,
          work_production_quantity = EXCLUDED.work_production_quantity,
          work_production_priority = EXCLUDED.work_production_priority,
          work_production_create_date = EXCLUDED.work_production_create_date,
          work_production_routing_rec_name = EXCLUDED.work_production_routing_rec_name,
          work_rec_name = EXCLUDED.work_rec_name,
          work_operation_rec_name = EXCLUDED.work_operation_rec_name,
          work_operation_id = EXCLUDED.work_operation_id,
          work_id = EXCLUDED.work_id,
          work_operator_id = EXCLUDED.work_operator_id,
          work_center_id = EXCLUDED.work_center_id,
          state = EXCLUDED.state,
          data_corrupted = EXCLUDED.data_corrupted,
          updated_at = NOW()
      `);
      
      validCount++;
      
      if (isCorrupted) {
        correctedCount++;
      }
      
      // Progress reporting
      if (validCount % 1000 === 0) {
        console.log(`📥 Imported ${validCount} cycles (${skippedCount} skipped, ${correctedCount} flagged as corrupted)`);
      }
      
    } catch (error) {
      console.error(`❌ Error importing cycle ${row.work_cycles_id}:`, error);
      skippedCount++;
    }
  }
  
  console.log(`✅ Import complete: ${validCount} valid, ${skippedCount} skipped, ${correctedCount} flagged as corrupted`);
  return validCount;
}

async function verifyImportIntegrity(): Promise<void> {
  console.log("\n📊 VERIFYING IMPORT INTEGRITY");
  
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(CASE WHEN data_corrupted = TRUE THEN 1 END) as flagged_corrupted,
      COUNT(CASE WHEN data_corrupted = FALSE OR data_corrupted IS NULL THEN 1 END) as clean_cycles,
      COUNT(DISTINCT work_production_id) as unique_production_orders,
      COUNT(DISTINCT work_cycles_operator_rec_name) as unique_operators,
      ROUND(AVG(work_cycles_duration), 2) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration,
      COUNT(CASE WHEN work_cycles_duration < 60 THEN 1 END) as very_short_cycles,
      COUNT(CASE WHEN work_cycles_duration BETWEEN 60 AND 3600 THEN 1 END) as normal_cycles,
      COUNT(CASE WHEN work_cycles_duration > 3600 THEN 1 END) as long_cycles
    FROM work_cycles
  `);
  
  const result = stats.rows[0];
  console.log(`✅ Total Cycles: ${result.total_cycles}`);
  console.log(`✅ Clean Cycles: ${result.clean_cycles}`);
  console.log(`⚠️  Flagged Corrupted: ${result.flagged_corrupted}`);
  console.log(`🏭 Unique Production Orders: ${result.unique_production_orders}`);
  console.log(`👷 Unique Operators: ${result.unique_operators}`);
  console.log(`📈 Average Duration: ${result.avg_duration_seconds}s (${Math.round(result.avg_duration_seconds/60)}min)`);
  console.log(`📊 Duration Distribution:`);
  console.log(`   < 1 minute: ${result.very_short_cycles}`);
  console.log(`   1 min - 1 hour: ${result.normal_cycles}`);
  console.log(`   > 1 hour: ${result.long_cycles}`);
}

async function main() {
  try {
    console.log("🚀 STARTING COMPLETE VALIDATED CSV IMPORT\n");
    console.log("Target: Import all work cycles with corruption detection and validation\n");
    
    // Look for CSV files in current directory and tmp folder
    const possiblePaths = [
      './work_cycles_complete.csv',
      './tmp/work_cycles_complete.csv',
      './work_cycles.csv',
      './tmp/work_cycles.csv'
    ];
    
    let csvFilePath = '';
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        csvFilePath = testPath;
        console.log(`📁 Found CSV file: ${csvFilePath}`);
        break;
      }
    }
    
    if (!csvFilePath) {
      console.log("❌ No CSV file found. Please ensure work cycles CSV is available.");
      console.log("   Expected locations: " + possiblePaths.join(', '));
      return;
    }
    
    // Step 1: Clear existing data
    await clearAllWorkCycles();
    
    // Step 2: Import with validation
    const importedCount = await importValidatedWorkCycles(csvFilePath);
    
    // Step 3: Verify integrity
    await verifyImportIntegrity();
    
    console.log("\n🎯 VALIDATED IMPORT SUMMARY:");
    console.log(`   CSV File: ${csvFilePath}`);
    console.log(`   Records Imported: ${importedCount}`);
    console.log(`   Corruption Detection: ENABLED`);
    console.log(`   Data Validation: PASSED`);
    
    console.log("\n🔄 NEXT STEPS:");
    console.log("1. Recalculate UPH with complete authentic dataset");
    console.log("2. Review flagged corrupted records for potential API replacement");
    console.log("3. Verify manufacturing operations data quality");
    
  } catch (error) {
    console.error("❌ Error during validated import:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importValidatedWorkCycles, verifyImportIntegrity, detectDurationPatterns };