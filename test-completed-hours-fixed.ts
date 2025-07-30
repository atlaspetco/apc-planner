#!/usr/bin/env tsx

/**
 * Test completed hours calculation after fixing MO numbers
 */

import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { isNotNull, gt, and, inArray } from "drizzle-orm";

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
        isNotNull(workCycles.work_production_number), // Require MO number
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
  
  console.log(`\nFound ${completedCycles.length} work cycles for dashboard MOs`);
  
  // Calculate completed hours per operator
  const completedHoursByOperator = new Map<string, number>();
  
  completedCycles.forEach(cycle => {
    if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
      const operatorName = cycle.operatorName;
      const durationHours = cycle.duration / 3600; // Convert seconds to hours
      
      const currentHours = completedHoursByOperator.get(operatorName) || 0;
      completedHoursByOperator.set(operatorName, currentHours + durationHours);
    }
  });
  
  console.log(`\n=== Completed Hours by Operator ===`);
  for (const [operator, hours] of completedHoursByOperator.entries()) {
    console.log(`${operator}: ${hours.toFixed(2)}h`);
  }
  
  // Show specific examples
  console.log(`\n=== Sample Work Cycles ===`);
  const courtneycycles = completedCycles.filter(c => c.operatorName?.includes('Courtney'));
  console.log(`Courtney Banh cycles: ${courtneyycles.length}`);
  courtneyycles.slice(0, 3).forEach((cycle, idx) => {
    const duration = (cycle.duration / 60).toFixed(1);
    console.log(`  ${idx + 1}. ${cycle.moNumber}: ${duration}min (Production ${cycle.productionId})`);
  });
  
  const evanCycles = completedCycles.filter(c => c.operatorName?.includes('Evan'));
  console.log(`\nEvan Crosby cycles: ${evanCycles.length}`);
  evanCycles.slice(0, 3).forEach((cycle, idx) => {
    const duration = (cycle.duration / 60).toFixed(1);
    console.log(`  ${idx + 1}. ${cycle.moNumber}: ${duration}min (Production ${cycle.productionId})`);
  });
  
  // Summary
  const totalOperators = completedHoursByOperator.size;
  const totalHours = Array.from(completedHoursByOperator.values()).reduce((sum, h) => sum + h, 0);
  
  console.log(`\n=== Summary ===`);
  console.log(`${totalOperators} operators with completed hours`);
  console.log(`${totalHours.toFixed(2)} total completed hours`);
  console.log(`${completedCycles.length} total work cycles found`);
  
  if (completedCycles.length > 0) {
    console.log(`✅ SUCCESS: Completed hours calculation now works!`);
  } else {
    console.log(`❌ ISSUE: Still no work cycles found for dashboard MOs`);
  }
}

testCompletedHoursFixed().catch(console.error);