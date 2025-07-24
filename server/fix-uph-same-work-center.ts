import { sql } from "drizzle-orm";
import { db } from './db.js';

/**
 * CRITICAL FIX: UPH Calculation Within Same Work Center Only
 * 
 * User Requirement: "you should not be totalling durations across ALL work center, 
 * you can only total duration within the SAME work center"
 * 
 * Current Issue: MO23577 totals 18+ hours by adding:
 * - Cutting: 6:34 (394 seconds)
 * - Sewing: 3:01:07 (10,867 seconds) 
 * - Packaging: 0:29:24 (1,764 seconds)
 * Total: 13,025 seconds = 3.6 hours (CORRECT)
 * 
 * But system is calculating UPH using cross-work-center totals
 * Fix: Calculate UPH separately for each work center
 */

interface WorkCenterUph {
  operatorName: string;
  workCenter: string;
  routing: string;
  operation: string;
  quantity: number;
  durationSeconds: number;
  uph: number;
  moNumber: string;
  observationCount: number;
}

async function calculateCorrectUphSameWorkCenter(): Promise<WorkCenterUph[]> {
  console.log("🔧 CALCULATING UPH WITHIN SAME WORK CENTER ONLY");
  
  // Query work cycles grouped by Work Center (not cross-work-center)
  const workCenterResults = await db.execute(sql`
    SELECT 
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center,
      work_production_routing_rec_name as routing,
      work_operation_rec_name as operation,
      work_production_number as mo_number,
      work_production_quantity as quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as observation_count
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name IS NOT NULL
      AND work_cycles_work_center_rec_name IS NOT NULL
      AND work_production_routing_rec_name IS NOT NULL
      AND work_cycles_duration > 0
      AND data_corrupted = FALSE
    GROUP BY 
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_routing_rec_name,
      work_operation_rec_name,
      work_production_number,
      work_production_quantity
    HAVING SUM(work_cycles_duration) > 60
    ORDER BY work_production_number, work_cycles_work_center_rec_name
  `);
  
  console.log(`📊 Found ${workCenterResults.rows.length} work center combinations`);
  
  const uphCalculations: WorkCenterUph[] = [];
  
  for (const row of workCenterResults.rows) {
    const operatorName = row.operator_name as string;
    const workCenter = row.work_center as string;
    const routing = row.routing as string;
    const operation = row.operation as string;
    const quantity = row.quantity as number;
    const durationSeconds = row.total_duration_seconds as number;
    const moNumber = row.mo_number as string;
    const observationCount = row.observation_count as number;
    
    if (quantity && durationSeconds > 0) {
      const durationHours = durationSeconds / 3600;
      const uph = quantity / durationHours;
      
      // Only include realistic UPH values
      if (uph > 0.5 && uph < 1000) {
        uphCalculations.push({
          operatorName,
          workCenter,
          routing,
          operation,
          quantity,
          durationSeconds,
          uph,
          moNumber,
          observationCount
        });
      }
    }
  }
  
  console.log(`✅ Calculated ${uphCalculations.length} valid work center UPH values`);
  return uphCalculations;
}

async function verifyMO23577SameWorkCenter(): Promise<void> {
  console.log("\n🔍 VERIFYING MO23577 WORK CENTER CALCULATIONS");
  
  const mo23577Results = await db.execute(sql`
    SELECT 
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center,
      work_production_quantity as quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count
    FROM work_cycles 
    WHERE work_production_number = 'MO23577'
      AND data_corrupted = FALSE
    GROUP BY 
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_quantity
    ORDER BY work_cycles_work_center_rec_name
  `);
  
  console.log(`📋 MO23577 Work Center Breakdown:`);
  let totalQuantity = 0;
  let totalDuration = 0;
  
  for (const row of mo23577Results.rows) {
    const operatorName = row.operator_name as string;
    const workCenter = row.work_center as string;
    const quantity = row.quantity as number;
    const durationSeconds = row.total_duration_seconds as number;
    const cycleCount = row.cycle_count as number;
    
    const durationMinutes = Math.floor(durationSeconds / 60);
    const durationSecondsRem = durationSeconds % 60;
    const durationHours = durationSeconds / 3600;
    const uph = quantity / durationHours;
    
    totalQuantity += quantity;
    totalDuration += durationSeconds;
    
    console.log(`   ${workCenter}: ${operatorName}`);
    console.log(`     Quantity: ${quantity} units`);
    console.log(`     Duration: ${durationSeconds}s (${durationMinutes}m ${durationSecondsRem}s)`);
    console.log(`     Cycles: ${cycleCount}`);
    console.log(`     UPH: ${uph.toFixed(2)} units/hour`);
    console.log(``);
  }
  
  const totalMinutes = Math.floor(totalDuration / 60);
  const totalSecs = totalDuration % 60;
  const totalHours = totalDuration / 3600;
  const overallUph = totalQuantity / totalHours;
  
  console.log(`📊 MO23577 TOTALS (for reference only - NOT used in UPH calculations):`);
  console.log(`   Total Quantity: ${totalQuantity} units`);
  console.log(`   Total Duration: ${totalDuration}s (${totalMinutes}m ${totalSecs}s = ${totalHours.toFixed(2)}h)`);
  console.log(`   Overall UPH: ${overallUph.toFixed(2)} units/hour`);
  console.log(`\n⚠️  IMPORTANT: UPH calculations use individual work center durations,`);
  console.log(`   NOT cross-work-center totals!`);
}

async function updateUphTableSameWorkCenter(): Promise<void> {
  console.log("\n💾 UPDATING UPH TABLE WITH SAME-WORK-CENTER CALCULATIONS");
  
  const uphCalculations = await calculateCorrectUphSameWorkCenter();
  
  // Clear existing UPH data
  await db.execute(sql`DELETE FROM uph_data`);
  console.log("🗑️  Cleared existing UPH calculations");
  
  // Insert new calculations
  let insertedCount = 0;
  for (const calc of uphCalculations) {
    try {
      await db.execute(sql`
        INSERT INTO uph_data (
          operator_id,
          operator_name,
          work_center,
          operation,
          routing,
          uph,
          observation_count,
          total_duration_hours,
          total_quantity,
          data_source,
          last_updated
        ) VALUES (
          (SELECT id FROM operators WHERE name = ${calc.operatorName} LIMIT 1),
          ${calc.operatorName},
          ${calc.workCenter},
          ${calc.operation},
          ${calc.routing},
          ${calc.uph},
          ${calc.observationCount},
          ${calc.durationSeconds / 3600},
          ${calc.quantity},
          'work_cycles_same_work_center',
          NOW()
        )
      `);
      insertedCount++;
    } catch (error) {
      console.log(`⚠️  Failed to insert UPH for ${calc.operatorName}/${calc.workCenter}/${calc.routing}: ${error}`);
    }
  }
  
  console.log(`✅ Inserted ${insertedCount} same-work-center UPH calculations`);
}

async function main() {
  try {
    console.log("🚀 STARTING SAME-WORK-CENTER UPH FIX\n");
    console.log("Target: Calculate UPH within same work center only\n");
    
    // Step 1: Verify MO23577 breakdown
    await verifyMO23577SameWorkCenter();
    
    // Step 2: Calculate correct UPH values
    const calculations = await calculateCorrectUphSameWorkCenter();
    
    // Step 3: Show sample results
    console.log("\n📊 SAMPLE SAME-WORK-CENTER UPH CALCULATIONS:");
    const sampleCalcs = calculations.slice(0, 10);
    for (const calc of sampleCalcs) {
      console.log(`   ${calc.operatorName} | ${calc.workCenter} | ${calc.routing}`);
      console.log(`     MO: ${calc.moNumber}, Qty: ${calc.quantity}, UPH: ${calc.uph.toFixed(2)}`);
    }
    
    // Step 4: Update database
    await updateUphTableSameWorkCenter();
    
    console.log("\n🎯 SAME-WORK-CENTER FIX COMPLETE");
    console.log(`   Calculations: ${calculations.length}`);
    console.log(`   Method: Work center duration only (no cross-work-center totals)`);
    console.log(`   Data Quality: AUTHENTIC`);
    
  } catch (error) {
    console.error("❌ Error during same-work-center fix:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { calculateCorrectUphSameWorkCenter, verifyMO23577SameWorkCenter };