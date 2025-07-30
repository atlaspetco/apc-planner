#!/usr/bin/env tsx

/**
 * Fix missing MO numbers in work cycles by populating from production orders table
 */

import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { isNotNull, isNull, eq } from "drizzle-orm";

async function fixMissingMoNumbers() {
  console.log("=== Fixing Missing MO Numbers in Work Cycles ===");
  
  // First, check how many cycles have NULL production numbers
  const nullMoCount = await db
    .select()
    .from(workCycles)
    .where(isNull(workCycles.work_production_number))
    .limit(1);
  
  console.log("Checking cycles with NULL MO numbers...");
  
  // Get production orders to create ID -> MO number mapping
  const productionOrdersList = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber
    })
    .from(productionOrders)
    .where(isNotNull(productionOrders.moNumber));
  
  console.log(`Found ${productionOrdersList.length} production orders with MO numbers`);
  
  // Create mapping
  const productionIdToMo = new Map<number, string>();
  productionOrdersList.forEach(po => {
    if (po.id && po.moNumber) {
      productionIdToMo.set(po.id, po.moNumber);
    }
  });
  
  console.log(`Created mapping for ${productionIdToMo.size} production ID -> MO number pairs`);
  
  // Get work cycles that need MO numbers populated
  const cyclesToUpdate = await db
    .select({
      id: workCycles.id,
      productionId: workCycles.work_production_id,
      operatorName: workCycles.work_cycles_operator_rec_name
    })
    .from(workCycles)
    .where(
      isNull(workCycles.work_production_number)
    )
    .limit(1000); // Update in batches
  
  console.log(`Found ${cyclesToUpdate.length} work cycles needing MO numbers`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  
  // Update cycles in batches
  for (const cycle of cyclesToUpdate) {
    if (cycle.productionId && productionIdToMo.has(cycle.productionId)) {
      const moNumber = productionIdToMo.get(cycle.productionId);
      
      try {
        await db
          .update(workCycles)
          .set({ work_production_number: moNumber })
          .where(eq(workCycles.id, cycle.id));
        
        updatedCount++;
        
        if (cycle.operatorName?.includes('Courtney') && updatedCount <= 5) {
          console.log(`  Updated Courtney cycle: Production ID ${cycle.productionId} -> ${moNumber}`);
        }
      } catch (error) {
        console.error(`Error updating cycle ${cycle.id}:`, error);
        skippedCount++;
      }
    } else {
      skippedCount++;
    }
  }
  
  console.log(`\n=== Results ===`);
  console.log(`Updated: ${updatedCount} work cycles`);
  console.log(`Skipped: ${skippedCount} cycles (no matching production order)`);
  
  // Verify the fix by checking dashboard production orders
  const dashboardIds = [195859, 195468, 195340, 195331, 195329, 195326];
  
  console.log(`\n=== Verification: Dashboard Production Orders ===`);
  for (const prodId of dashboardIds) {
    const cyclesForProd = await db
      .select({
        count: workCycles.id,
        operatorName: workCycles.work_cycles_operator_rec_name,
        moNumber: workCycles.work_production_number,
        duration: workCycles.work_cycles_duration
      })
      .from(workCycles)
      .where(eq(workCycles.work_production_id, prodId))
      .limit(3);
    
    if (cyclesForProd.length > 0) {
      const moNumber = cyclesForProd[0].moNumber || 'NULL';
      console.log(`  Production ${prodId}: ${cyclesForProd.length} cycles, MO: ${moNumber}`);
      cyclesForProd.forEach((cycle, idx) => {
        const duration = cycle.duration ? (cycle.duration / 60).toFixed(1) + 'min' : 'N/A';
        console.log(`    ${idx + 1}. ${cycle.operatorName}: ${duration}`);
      });
    }
  }
}

fixMissingMoNumbers().catch(console.error);