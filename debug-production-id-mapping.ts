#!/usr/bin/env tsx

/**
 * Debug script to check production order ID mapping between dashboard and work cycles
 */

import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { isNotNull, gt, and, like } from "drizzle-orm";

async function debugProductionIdMapping() {
  console.log("=== Debugging Production Order ID Mapping ===");
  
  // Get current dashboard production orders (same logic as assignments endpoint)
  const dashboardProductionOrders = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber,
      quantity: productionOrders.quantity
    })
    .from(productionOrders)
    .limit(10);
  
  console.log(`Dashboard has ${dashboardProductionOrders.length} production orders:`);
  dashboardProductionOrders.forEach(po => {
    console.log(`  ID: ${po.id}, MO: ${po.moNumber}, Qty: ${po.quantity}`);
  });
  
  // Check work cycles production IDs
  const uniqueWorkCycleProductionIds = await db
    .selectDistinct({
      productionId: workCycles.work_production_id,
      productionNumber: workCycles.work_production_number,
    })
    .from(workCycles)
    .where(
      and(
        isNotNull(workCycles.work_production_id),
        gt(workCycles.work_cycles_duration, 0)
      )
    )
    .limit(20);
  
  console.log(`\nWork cycles have ${uniqueWorkCycleProductionIds.length} unique production IDs:`);
  uniqueWorkCycleProductionIds.forEach(wc => {
    console.log(`  Production ID: ${wc.productionId}, Production Number: ${wc.productionNumber}`);
  });
  
  // Check for matches between dashboard and work cycles
  const dashboardIds = dashboardProductionOrders.map(po => po.id);
  const workCycleIds = uniqueWorkCycleProductionIds.map(wc => wc.productionId);
  
  console.log(`\nDashboard production order IDs: [${dashboardIds.slice(0, 5).join(', ')}...]`);
  console.log(`Work cycle production IDs: [${workCycleIds.slice(0, 5).join(', ')}...]`);
  
  const matches = dashboardIds.filter(id => workCycleIds.includes(id));
  console.log(`\nMatching production IDs: ${matches.length}`);
  if (matches.length > 0) {
    console.log(`Matches: [${matches.join(', ')}]`);
  } else {
    console.log("❌ NO MATCHES FOUND - This explains why completed hours are 0");
  }
  
  // Check if MO numbers match instead of IDs
  const dashboardMoNumbers = dashboardProductionOrders.map(po => po.moNumber);
  const workCycleMoNumbers = uniqueWorkCycleProductionIds
    .map(wc => wc.productionNumber)
    .filter(num => num != null);
  
  console.log(`\nDashboard MO numbers: [${dashboardMoNumbers.slice(0, 5).join(', ')}...]`);
  console.log(`Work cycle MO numbers: [${workCycleMoNumbers.slice(0, 5).join(', ')}...]`);
  
  const moMatches = dashboardMoNumbers.filter(mo => 
    workCycleMoNumbers.some(wcMo => wcMo?.includes(mo?.replace('MO', '') || ''))
  );
  console.log(`\nMatching MO numbers: ${moMatches.length}`);
  if (moMatches.length > 0) {
    console.log(`MO Matches: [${moMatches.join(', ')}]`);
  }
  
  // Look for Courtney specifically in recent work cycles
  console.log(`\n=== Courtney Work Cycles Analysis ===`);
  const courtneyRecentCycles = await db
    .select({
      productionId: workCycles.work_production_id,
      productionNumber: workCycles.work_production_number,
      duration: workCycles.work_cycles_duration,
      workCenter: workCycles.work_cycles_work_center_rec_name,
      createDate: workCycles.work_production_create_date
    })
    .from(workCycles)
    .where(
      and(
        like(workCycles.work_cycles_operator_rec_name, "%Courtney%"),
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration)
      )
    )
    .limit(20);
  
  console.log(`Courtney's work cycles production IDs: [${courtneyRecentCycles.map(c => c.productionId).slice(0, 10).join(', ')}...]`);
  console.log(`Courtney's work cycles production numbers: [${courtneyRecentCycles.map(c => c.productionNumber).filter(p => p).slice(0, 5).join(', ')}...]`);
}

debugProductionIdMapping().catch(console.error);