#!/usr/bin/env tsx

/**
 * Debug completed hours calculation to see why numbers are so high
 */

import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { isNotNull, gt, and, inArray } from "drizzle-orm";

async function debugCompletedHours() {
  console.log("=== Debug Completed Hours Calculation ===");
  
  // Get current dashboard production orders (similar to routes.ts)
  const dashboardMOs = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber
    })
    .from(productionOrders)
    .where(isNotNull(productionOrders.moNumber))
    .limit(20); // Get a reasonable sample
  
  const dashboardProductionOrderIds = dashboardMOs.map(mo => mo.id);
  console.log(`\nDashboard has ${dashboardProductionOrderIds.length} production orders`);
  
  // 1. Test with dashboard filter (what SHOULD be happening)
  console.log("\n=== Testing Dashboard-Only Filter ===");
  const dashboardOnlyCycles = await db
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
        isNotNull(workCycles.work_production_number),
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
  
  console.log(`Found ${dashboardOnlyCycles.length} cycles with dashboard filter`);
  
  // Calculate dashboard-only completed hours
  const dashboardHours = new Map<string, number>();
  dashboardOnlyCycles.forEach(cycle => {
    if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
      const operatorName = cycle.operatorName;
      const durationHours = cycle.duration / 3600;
      dashboardHours.set(operatorName, (dashboardHours.get(operatorName) || 0) + durationHours);
    }
  });
  
  console.log("\nDashboard-only completed hours:");
  for (const [operator, hours] of dashboardHours.entries()) {
    console.log(`  ${operator}: ${hours.toFixed(2)}h`);
  }
  
  // 2. Test without dashboard filter (what might be happening accidentally)
  console.log("\n=== Testing All Work Cycles (No Dashboard Filter) ===");
  const allCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      duration: workCycles.work_cycles_duration
    })
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        isNotNull(workCycles.work_cycles_operator_rec_name),
        isNotNull(workCycles.work_production_number)
      )
    );
  
  console.log(`Found ${allCycles.length} total cycles without dashboard filter`);
  
  // Calculate all-time completed hours
  const allTimeHours = new Map<string, number>();
  allCycles.forEach(cycle => {
    if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
      const operatorName = cycle.operatorName;
      const durationHours = cycle.duration / 3600;
      allTimeHours.set(operatorName, (allTimeHours.get(operatorName) || 0) + durationHours);
    }
  });
  
  console.log("\nAll-time completed hours (what UI might be showing):");
  for (const [operator, hours] of allTimeHours.entries()) {
    if (hours > 100) { // Only show operators with significant hours
      console.log(`  ${operator}: ${hours.toFixed(1)}h`);
    }
  }
  
  // 3. Check specific operators from screenshot
  console.log("\n=== Checking Specific Operators from Screenshot ===");
  const targetOperators = ['Devin Cann', 'Evan Crosby', 'Courtney Banh', 'Dani Mayta'];
  
  for (const operator of targetOperators) {
    const dashboardHour = dashboardHours.get(operator) || 0;
    const allTimeHour = allTimeHours.get(operator) || 0;
    
    console.log(`${operator}:`);
    console.log(`  Dashboard only: ${dashboardHour.toFixed(2)}h`);
    console.log(`  All-time: ${allTimeHour.toFixed(1)}h`);
    console.log(`  UI shows: ${operator === 'Devin Cann' ? '1717.9h' : 
                             operator === 'Evan Crosby' ? '506.4h' : 
                             operator === 'Courtney Banh' ? '8725.8h' : 
                             operator === 'Dani Mayta' ? '2100.4h' : 'unknown'}`);
  }
  
  // 4. Check if there's a bug in the production order filtering
  console.log("\n=== Dashboard Production Order IDs Sample ===");
  console.log(`First 10 dashboard production IDs: ${dashboardProductionOrderIds.slice(0, 10)}`);
  
  // Check if any cycles match these IDs
  const sampleCycleCheck = await db
    .select({
      productionId: workCycles.work_production_id,
      operatorName: workCycles.work_cycles_operator_rec_name,
      moNumber: workCycles.work_production_number
    })
    .from(workCycles)
    .where(
      and(
        inArray(workCycles.work_production_id, dashboardProductionOrderIds.slice(0, 5)),
        isNotNull(workCycles.work_production_number)
      )
    )
    .limit(10);
  
  console.log(`\nSample cycles matching first 5 dashboard production IDs:`);
  sampleCycleCheck.forEach(cycle => {
    console.log(`  Production ${cycle.productionId}: ${cycle.operatorName} - ${cycle.moNumber}`);
  });
}

debugCompletedHours().catch(console.error);