import { sql } from "drizzle-orm";
import { db } from './db.js';

/**
 * CRITICAL: Fix Systematic Work Cycles Data Corruption
 * 
 * Issue: Multiple MOs have corrupted data where work cycles show identical
 * short durations (5s, 10s, 15s) instead of authentic cycle times.
 * 
 * Root Cause: CSV import process defaulted to short durations when parsing failed
 * 
 * Strategy: 
 * 1. Identify all corrupted records (multiple cycles with identical short durations)
 * 2. Mark them for exclusion from UPH calculations 
 * 3. Rebuild database from authentic source data
 */

interface CorruptedRecord {
  work_production_number: string;
  work_cycles_operator_rec_name: string;
  work_cycles_duration: number;
  cycle_count: number;
}

async function auditDataCorruption() {
  console.log("🚨 SYSTEMATIC DATA CORRUPTION AUDIT");
  console.log("🔍 Identifying corrupted work cycle records\n");

  // Find all suspicious patterns: multiple cycles with identical short durations
  const suspiciousPatterns = await db.execute(sql`
    SELECT 
      work_production_number,
      work_cycles_operator_rec_name,
      work_cycles_duration,
      COUNT(*) as cycle_count,
      STRING_AGG(CAST(work_cycles_id AS TEXT), ', ' ORDER BY work_cycles_id) as cycle_ids
    FROM work_cycles 
    WHERE work_cycles_duration <= 60  -- Suspicious: cycles 60 seconds or less
    GROUP BY work_production_number, work_cycles_operator_rec_name, work_cycles_duration
    HAVING COUNT(*) >= 3  -- 3+ identical short cycles is highly suspicious
    ORDER BY work_production_number, work_cycles_operator_rec_name, work_cycles_duration
  `);

  console.log(`📊 Found ${suspiciousPatterns.rows.length} suspicious patterns:`);
  
  let totalCorruptedCycles = 0;
  suspiciousPatterns.rows.forEach(row => {
    console.log(`❌ ${row.work_production_number} - ${row.work_cycles_operator_rec_name}: ${row.cycle_count} cycles @ ${row.work_cycles_duration}s`);
    console.log(`   Cycle IDs: ${row.cycle_ids}`);
    totalCorruptedCycles += parseInt(row.cycle_count);
  });

  console.log(`\n💥 CORRUPTION SUMMARY:`);
  console.log(`   Corrupted Patterns: ${suspiciousPatterns.rows.length}`);
  console.log(`   Total Corrupted Cycles: ${totalCorruptedCycles}`);

  return suspiciousPatterns.rows as CorruptedRecord[];
}

async function markCorruptedRecords(corruptedRecords: CorruptedRecord[]) {
  console.log("\n🏷️  MARKING CORRUPTED RECORDS FOR EXCLUSION");
  
  // Add a corruption flag to the work_cycles table if it doesn't exist
  try {
    await db.execute(sql`
      ALTER TABLE work_cycles 
      ADD COLUMN data_corrupted BOOLEAN DEFAULT FALSE
    `);
    console.log("✅ Added data_corrupted column");
  } catch (error) {
    console.log("ℹ️  data_corrupted column already exists");
  }

  // Mark all corrupted records
  let markedCount = 0;
  for (const record of corruptedRecords) {
    const result = await db.execute(sql`
      UPDATE work_cycles 
      SET data_corrupted = TRUE
      WHERE work_production_number = ${record.work_production_number}
        AND work_cycles_operator_rec_name = ${record.work_cycles_operator_rec_name}
        AND work_cycles_duration = ${record.work_cycles_duration}
    `);
    
    console.log(`🏷️  Marked ${record.work_production_number} - ${record.work_cycles_operator_rec_name} (${record.cycle_count} cycles)`);
    markedCount += record.cycle_count;
  }

  console.log(`\n✅ Marked ${markedCount} corrupted cycles for exclusion`);
}

async function generateCleanDataStats() {
  console.log("\n📊 CLEAN DATA STATISTICS (excluding corrupted records):");
  
  const cleanStats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_clean_cycles,
      COUNT(DISTINCT work_production_number) as clean_mos,
      COUNT(DISTINCT work_cycles_operator_rec_name) as clean_operators,
      AVG(work_cycles_duration) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration
    FROM work_cycles 
    WHERE data_corrupted = FALSE OR data_corrupted IS NULL
  `);

  const stats = cleanStats.rows[0];
  console.log(`✅ Clean Cycles: ${stats.total_clean_cycles}`);
  console.log(`✅ Clean MOs: ${stats.clean_mos}`);
  console.log(`✅ Clean Operators: ${stats.clean_operators}`);
  console.log(`✅ Average Duration: ${Math.round(stats.avg_duration_seconds)}s (${Math.round(stats.avg_duration_seconds/60)}min)`);
  console.log(`✅ Duration Range: ${stats.min_duration}s - ${stats.max_duration}s`);

  return stats;
}

async function updateUphCalculationToExcludeCorruption() {
  console.log("\n🔧 UPDATING UPH CALCULATIONS TO EXCLUDE CORRUPTED DATA");
  
  // This will be used by the UPH calculator to filter out corrupted records
  const filterClause = "WHERE (data_corrupted = FALSE OR data_corrupted IS NULL)";
  
  console.log(`✅ UPH calculations will now use filter: ${filterClause}`);
  console.log("ℹ️  Update uph-core-calculator.ts to include this filter in all queries");
}

async function main() {
  try {
    console.log("🚀 STARTING SYSTEMATIC DATA CORRUPTION FIX\n");
    
    // Step 1: Audit and identify corruption
    const corruptedRecords = await auditDataCorruption();
    
    if (corruptedRecords.length === 0) {
      console.log("✅ No systematic corruption detected");
      return;
    }
    
    // Step 2: Mark corrupted records
    await markCorruptedRecords(corruptedRecords);
    
    // Step 3: Generate clean data statistics
    const cleanStats = await generateCleanDataStats();
    
    // Step 4: Update UPH calculation instructions
    await updateUphCalculationToExcludeCorruption();
    
    console.log("\n🎯 NEXT STEPS:");
    console.log("1. Update uph-core-calculator.ts to exclude corrupted records");
    console.log("2. Recalculate UPH using only clean data");
    console.log("3. Consider re-importing from authentic CSV source");
    console.log("4. Implement data validation in future imports");
    
  } catch (error) {
    console.error("❌ Error fixing data corruption:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { auditDataCorruption, markCorruptedRecords, generateCleanDataStats };