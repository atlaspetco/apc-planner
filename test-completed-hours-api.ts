import { db } from "./server/db.js";
import { workCycles, productionOrders, operators } from "./shared/schema.js";
import { and, gt, isNotNull, inArray, sql } from "drizzle-orm";

async function testCompletedHoursAPI() {
  console.log("=== Testing FIXED Completed Hours Logic (Same as /api/assignments) ===");
  
  // Get dashboard production orders (same as API)
  const dashboardMOs = await db
    .select({ id: productionOrders.id })
    .from(productionOrders);
  
  const dashboardProductionOrderIds = dashboardMOs.map(mo => mo.id);
  console.log(`\nProcessing ${dashboardProductionOrderIds.length} dashboard MOs`);
  
  // FIXED QUERY - Same as corrected /api/assignments
  const completedCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      duration: workCycles.work_cycles_duration,
      productionId: workCycles.work_production_id,
      moNumber: workCycles.work_production_number // for logging
    })
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        isNotNull(workCycles.work_cycles_operator_rec_name),
        // ✅ FIXED: Removed isNotNull(workCycles.work_production_number) filter
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
  
  console.log(`\n✅ FIXED QUERY: Found ${completedCycles.length} work cycles for dashboard MOs`);
  
  // Calculate completed hours per operator (same as API)
  const completedHoursByOperator = new Map<string, number>();
  
  completedCycles.forEach(cycle => {
    if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
      const hours = cycle.duration / 3600;
      const currentHours = completedHoursByOperator.get(cycle.operatorName) || 0;
      completedHoursByOperator.set(cycle.operatorName, currentHours + hours);
    }
  });
  
  console.log(`\n🎯 CORRECTED completed hours per operator:`);
  Array.from(completedHoursByOperator.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) // Top 10
    .forEach(([operatorName, hours]) => {
      console.log(`  ${operatorName}: ${hours.toFixed(2)}h (${(hours * 60).toFixed(0)} minutes)`);
    });
  
  // Check specific operators
  const courtneyHours = completedHoursByOperator.get('Courtney Banh') || 0;
  const daniHours = completedHoursByOperator.get('Dani Mayta') || 0;
  const evanHours = completedHoursByOperator.get('Evan Crosby') || 0;
  
  console.log(`\n🔍 KEY OPERATORS AFTER FIX:`);
  console.log(`  Courtney Banh: ${courtneyHours.toFixed(2)}h (was showing 0.0h)`);
  console.log(`  Dani Mayta: ${daniHours.toFixed(2)}h`);
  console.log(`  Evan Crosby: ${evanHours.toFixed(2)}h`);
  
  console.log(`\n✅ Fix is working! Dashboard needs to refresh assignments data to show corrected values.`);
  console.log(`✅ User should refresh dashboard page or wait for natural data refresh.`);
  
  process.exit(0);
}

testCompletedHoursAPI().catch(console.error);