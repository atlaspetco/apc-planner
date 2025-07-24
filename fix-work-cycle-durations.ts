import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { eq } from "drizzle-orm";

// This script fixes the fundamental data structure issue where CSV export
// from Fulfil's one-to-many relationship created repeated total values
// instead of individual cycle values

async function fixWorkCycleDurations() {
  console.log("🔍 Analyzing work cycle data structure issue...");
  
  // Get all work cycles with suspicious durations (over 8 hours = 28800 seconds)
  const suspiciousCycles = await db
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
  
  console.log(`📊 Found ${suspiciousCycles.length} work cycles with suspicious durations (>8 hours)`);
  
  // Group by MO to see the pattern
  const moGroups = new Map<string, typeof suspiciousCycles>();
  
  suspiciousCycles.forEach(cycle => {
    const moNumber = cycle.work_production_number;
    if (!moGroups.has(moNumber)) {
      moGroups.set(moNumber, []);
    }
    moGroups.get(moNumber)!.push(cycle);
  });
  
  console.log(`📈 These affect ${moGroups.size} Manufacturing Orders`);
  
  // Show examples of the pattern
  console.log("\n🔍 Examples of repeated duration pattern:");
  let exampleCount = 0;
  for (const [moNumber, cycles] of moGroups) {
    if (exampleCount >= 3) break;
    
    console.log(`\n   ${moNumber} (${cycles.length} cycles):`);
    cycles.forEach((cycle, index) => {
      console.log(`     Cycle ${index + 1}: ${(cycle.duration_sec! / 3600).toFixed(2)}h, Qty: ${cycle.work_cycles_quantity_done}`);
    });
    
    // Check if all durations are identical (indicating the one-to-many problem)
    const firstDuration = cycles[0].duration_sec;
    const allSame = cycles.every(c => c.duration_sec === firstDuration);
    console.log(`     ❗ All durations identical: ${allSame ? 'YES (One-to-Many issue)' : 'NO'}`);
    
    exampleCount++;
  }
  
  // Count how many MOs have this pattern
  let affectedMOs = 0;
  let totalAffectedCycles = 0;
  
  for (const [moNumber, cycles] of moGroups) {
    const firstDuration = cycles[0].duration_sec;
    const allSame = cycles.every(c => c.duration_sec === firstDuration);
    
    if (allSame) {
      affectedMOs++;
      totalAffectedCycles += cycles.length;
    }
  }
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`   Manufacturing Orders with repeated duration pattern: ${affectedMOs}`);
  console.log(`   Total work cycles affected: ${totalAffectedCycles}`);
  console.log(`   These need to be fixed by using only ONE cycle per MO`);
  console.log(`   Current system incorrectly sums ${totalAffectedCycles} repeated values`);
  
  console.log(`\n💡 SOLUTION:`);
  console.log(`   For each MO with repeated durations:`);
  console.log(`   1. Keep only the first work cycle (it contains the correct total)`);
  console.log(`   2. Delete the duplicate cycles (they're just repeated data)`);
  console.log(`   3. This will fix the inflated duration calculations`);
  
  // Optional: Show specific recommendations for top affected MOs
  const sortedMOs = Array.from(moGroups.entries())
    .filter(([_, cycles]) => {
      const firstDuration = cycles[0].duration_sec;
      return cycles.every(c => c.duration_sec === firstDuration);
    })
    .sort(([_, a], [__, b]) => b.length - a.length)
    .slice(0, 10);
  
  console.log(`\n🎯 TOP 10 Most Affected MOs:`);
  sortedMOs.forEach(([moNumber, cycles], index) => {
    const hours = (cycles[0].duration_sec! / 3600).toFixed(2);
    console.log(`   ${index + 1}. ${moNumber}: ${cycles.length} duplicate cycles x ${hours}h each = ${(cycles.length * parseFloat(hours)).toFixed(2)}h total inflation`);
  });
}

// Import necessary SQL function
import { sql } from "drizzle-orm";

// Run the analysis
fixWorkCycleDurations()
  .then(() => {
    console.log("\n✅ Analysis complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });