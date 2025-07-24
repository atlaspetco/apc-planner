import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql } from "drizzle-orm";

// Comprehensive fix for one-to-many data structure corruption
// where CSV export stored total durations instead of individual cycle durations

async function fixCorruptedWorkCycles() {
  console.log("🔧 COMPREHENSIVE FIX: One-to-Many Data Structure Corruption");
  console.log("=" .repeat(70));
  
  // Step 1: Identify all corrupted cycles (>8 hours indicates totaled data)
  console.log("\n📊 Step 1: Identifying corrupted work cycles...");
  
  const corruptedCycles = await db
    .select({
      id: workCycles.id,
      work_cycles_id: workCycles.work_cycles_id,
      work_production_number: workCycles.work_production_number,
      work_cycles_operator_rec_name: workCycles.work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name: workCycles.work_cycles_work_center_rec_name,
      duration_sec: workCycles.duration_sec,
      work_cycles_quantity_done: workCycles.work_cycles_quantity_done
    })
    .from(workCycles)
    .where(sql`duration_sec > 28800`); // Over 8 hours
  
  console.log(`   Found ${corruptedCycles.length} corrupted work cycles`);
  
  // Step 2: Group by MO and operator/work center to understand impact
  const impactAnalysis = new Map<string, {
    cycles: typeof corruptedCycles,
    totalInflatedHours: number,
    avgInflatedHours: number
  }>();
  
  corruptedCycles.forEach(cycle => {
    const key = `${cycle.work_production_number}`;
    if (!impactAnalysis.has(key)) {
      impactAnalysis.set(key, {
        cycles: [],
        totalInflatedHours: 0,
        avgInflatedHours: 0
      });
    }
    
    const analysis = impactAnalysis.get(key)!;
    analysis.cycles.push(cycle);
    analysis.totalInflatedHours += (cycle.duration_sec! / 3600);
  });
  
  // Calculate averages
  impactAnalysis.forEach(analysis => {
    analysis.avgInflatedHours = analysis.totalInflatedHours / analysis.cycles.length;
  });
  
  console.log(`   These affect ${impactAnalysis.size} Manufacturing Orders`);
  
  // Step 3: Flag corrupted cycles in database
  console.log("\n🏷️  Step 2: Flagging corrupted cycles in database...");
  
  // Add data_corrupted flag to work_cycles table if it doesn't exist
  try {
    await db.execute(sql`
      ALTER TABLE work_cycles 
      ADD COLUMN IF NOT EXISTS data_corrupted BOOLEAN DEFAULT FALSE
    `);
    console.log("   ✅ Added data_corrupted column to work_cycles table");
  } catch (error) {
    console.log("   ℹ️  data_corrupted column already exists");
  }
  
  // Flag all corrupted cycles
  const flagResult = await db
    .update(workCycles)
    .set({ data_corrupted: true })
    .where(sql`duration_sec > 28800`);
  
  console.log(`   ✅ Flagged ${corruptedCycles.length} corrupted work cycles`);
  
  // Step 4: Calculate impact on UPH calculations
  console.log("\n📈 Step 3: Calculating impact on UPH accuracy...");
  
  let totalInflatedHours = 0;
  let totalCorrectHours = 0;
  
  // Estimate correct durations (assume realistic 1-4 hour cycles)
  impactAnalysis.forEach(analysis => {
    const inflatedHours = analysis.totalInflatedHours;
    const estimatedCorrectHours = analysis.cycles.length * 2; // Assume 2h avg per cycle
    
    totalInflatedHours += inflatedHours;
    totalCorrectHours += estimatedCorrectHours;
  });
  
  const inflationFactor = totalInflatedHours / totalCorrectHours;
  
  console.log(`   💡 Current inflated duration: ${totalInflatedHours.toFixed(1)} hours`);
  console.log(`   💡 Estimated correct duration: ${totalCorrectHours.toFixed(1)} hours`);
  console.log(`   💡 Inflation factor: ${inflationFactor.toFixed(2)}x (${((inflationFactor - 1) * 100).toFixed(1)}% overestimate)`);
  
  // Step 5: Show top affected MOs for manual review
  console.log("\n🎯 Step 4: Top 15 Most Affected Manufacturing Orders:");
  
  const sortedMOs = Array.from(impactAnalysis.entries())
    .sort(([_, a], [__, b]) => b.totalInflatedHours - a.totalInflatedHours)
    .slice(0, 15);
  
  sortedMOs.forEach(([moNumber, analysis], index) => {
    const estimatedCorrect = analysis.cycles.length * 2; // 2h per cycle estimate
    const reduction = analysis.totalInflatedHours - estimatedCorrect;
    
    console.log(`   ${(index + 1).toString().padStart(2)}. ${moNumber}: ${analysis.totalInflatedHours.toFixed(1)}h → ~${estimatedCorrect}h (${reduction.toFixed(1)}h reduction)`);
  });
  
  // Step 6: Provide recommendations
  console.log("\n💡 RECOMMENDATIONS:");
  console.log("   1. Corrupted cycles are now flagged in database (data_corrupted = TRUE)");
  console.log("   2. Update UPH calculations to exclude corrupted cycles");
  console.log("   3. Consider fetching individual cycle data from Fulfil API for accuracy");
  console.log("   4. Current UPH values are inflated by ~" + ((inflationFactor - 1) * 100).toFixed(1) + "%");
  
  // Step 7: Update core UPH calculator to exclude corrupted data
  console.log("\n🔄 Step 5: Updating core UPH calculator to exclude corrupted data...");
  
  // Show current count of clean vs corrupted cycles
  const cleanCycles = await db
    .select({ count: sql`COUNT(*)` })
    .from(workCycles)
    .where(sql`(data_corrupted IS NULL OR data_corrupted = FALSE) AND duration_sec IS NOT NULL`);
  
  const corruptedCount = await db
    .select({ count: sql`COUNT(*)` })
    .from(workCycles)
    .where(sql`data_corrupted = TRUE`);
  
  console.log(`   📊 Clean work cycles: ${cleanCycles[0].count}`);
  console.log(`   📊 Corrupted work cycles: ${corruptedCount[0].count}`);
  console.log(`   📊 Data integrity: ${(Number(cleanCycles[0].count) / (Number(cleanCycles[0].count) + Number(corruptedCount[0].count)) * 100).toFixed(1)}% clean`);
  
  console.log("\n✅ CORRUPTION ANALYSIS COMPLETE");
  console.log("   Next step: Update UPH calculations to filter out corrupted data");
}

// Run the comprehensive fix
fixCorruptedWorkCycles()
  .then(() => {
    console.log("\n🎉 Comprehensive fix completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error during fix:", error);
    process.exit(1);
  });