import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { and, gt, isNotNull, inArray } from "drizzle-orm";

async function testCompletedHoursFixed() {
  console.log("=== Testing Completed Hours After MO Number Fix ===");
  
  // Simulate getting dashboard production order IDs
  const dashboardMOs = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber
    })
    .from(productionOrders)
    .limit(10);
  
  const dashboardProductionOrderIds = dashboardMOs.map(mo => mo.id);
  console.log(`Testing with ${dashboardProductionOrderIds.length} dashboard production orders:`);
  dashboardMOs.forEach(mo => console.log(`  ${mo.id}: ${mo.moNumber}`));
  
  // Test the completed cycles query (same as routes.ts)
  const completedCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      productionId: workCycles.work_production_id,
      duration: workCycles.work_cycles_duration,
      moNumber: workCycles.work_production_number
    })
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        isNotNull(workCycles.work_cycles_operator_rec_name),
        // REMOVED: isNotNull(workCycles.work_production_number) - this was the bug!
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
  
  console.log(`\nFound ${completedCycles.length} work cycles for dashboard MOs`);
  
  // Calculate completed hours per operator
  const completedHoursByOperator = new Map<string, number>();
  
  completedCycles.forEach(cycle => {
    if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
      const hours = cycle.duration / 3600;
      const currentHours = completedHoursByOperator.get(cycle.operatorName) || 0;
      completedHoursByOperator.set(cycle.operatorName, currentHours + hours);
    }
  });
  
  console.log(`\n✅ CORRECTED completed hours per operator:`);
  Array.from(completedHoursByOperator.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([operatorName, hours]) => {
      console.log(`  ${operatorName}: ${hours.toFixed(2)}h completed`);
    });
  
  // Check Courtney specifically
  const courtneyHours = completedHoursByOperator.get('Courtney Banh') || 0;
  console.log(`\n🎯 Courtney Banh corrected completed hours: ${courtneyHours.toFixed(2)}h (${(courtneyHours * 60).toFixed(1)} minutes)`);
  console.log(`🎯 This should now show ${courtneyHours.toFixed(2)}h in the dashboard instead of 0.0h`);
  
  process.exit(0);
}

testCompletedHoursFixed().catch(console.error);