/**
 * Fix UPH calculations - calculate each work order individually, then weighted average per operator
 * UPH = Work Order Quantity / Total Duration Hours (per individual work order)
 * Then aggregate with weighted averages based on observations per operator
 */

import { db } from "./db.js";
import { historicalUph, workCycles } from "../shared/schema.js";

interface ProductionOrderWorkCenter {
  productionId: number;
  operatorName: string;
  operatorId: number;
  routing: string;
  workCenter: string;
  totalQuantity: number;
  totalDurationSeconds: number;
  totalHours: number;
  uphPerMO: number;
  totalCycleCount: number;
  workOrderIds: number[];
}

async function fixUphIndividualWorkOrders() {
  console.log("Calculating UPH for each individual work order, then weighted averaging per operator...");

  try {
    const allCycles = await db.select().from(workCycles);
    console.log(`Retrieved ${allCycles.length} work cycles from database`);

    // Step 1: Group work orders by Production Order + Operator + Work Center Category
    // This aggregates durations from multiple WOs in same work center before calculating UPH
    const productionOrderMap = new Map<string, ProductionOrderWorkCenter>();

    for (const cycle of allCycles) {
      if (!cycle.work_id || 
          !cycle.work_production_id ||
          !cycle.work_cycles_operator_rec_name || 
          !cycle.work_production_routing_rec_name || 
          !cycle.work_cycles_work_center_rec_name ||
          !cycle.work_cycles_duration ||
          cycle.work_cycles_duration < 120) {
        continue;
      }

      // Categorize work center
      let workCenterCategory = 'Unknown';
      const wc = cycle.work_cycles_work_center_rec_name.toLowerCase();
      
      if (wc.includes('cutting') || wc.includes('laser') || wc.includes('webbing')) {
        workCenterCategory = 'Cutting';
      } else if (wc.includes('sewing') || wc.includes('assembly') || wc.includes('rope') || wc.includes('embroidery')) {
        workCenterCategory = 'Assembly';
      } else if (wc.includes('packaging') || wc.includes('pack')) {
        workCenterCategory = 'Packaging';
      }

      if (workCenterCategory === 'Unknown') continue;

      // Key by Production Order + Operator + Work Center (aggregates multiple WOs in same category)
      const key = `${cycle.work_production_id}|${cycle.work_cycles_operator_rec_name}|${workCenterCategory}`;
      
      if (!productionOrderMap.has(key)) {
        productionOrderMap.set(key, {
          productionId: cycle.work_production_id,
          operatorName: cycle.work_cycles_operator_rec_name,
          operatorId: cycle.work_cycles_operator_id || 0,
          routing: cycle.work_production_routing_rec_name,
          workCenter: workCenterCategory,
          totalQuantity: 0,
          totalDurationSeconds: 0,
          totalHours: 0,
          uphPerMO: 0,
          totalCycleCount: 0,
          workOrderIds: []
        });
      }

      const moWorkCenter = productionOrderMap.get(key)!;
      moWorkCenter.totalDurationSeconds += cycle.work_cycles_duration;
      moWorkCenter.totalCycleCount += 1;
      
      // Track work order IDs for this MO + Work Center combination
      if (!moWorkCenter.workOrderIds.includes(cycle.work_id)) {
        moWorkCenter.workOrderIds.push(cycle.work_id);
      }
      
      // Use the maximum quantity_done across all cycles for this MO + Work Center
      if (cycle.work_cycles_quantity_done && cycle.work_cycles_quantity_done > moWorkCenter.totalQuantity) {
        moWorkCenter.totalQuantity = cycle.work_cycles_quantity_done;
      }
    }

    // Calculate UPH for each Production Order + Work Center combination
    const productionOrderWorkCenters: ProductionOrderWorkCenter[] = [];
    
    for (const moWorkCenter of productionOrderMap.values()) {
      if (moWorkCenter.operatorId === 0 || moWorkCenter.totalDurationSeconds === 0) continue;
      
      // Skip MOs with no quantity data (can't calculate UPH)
      if (moWorkCenter.totalQuantity === 0) {
        console.log(`Skipping MO ${moWorkCenter.productionId} ${moWorkCenter.workCenter} - no quantity data`);
        continue;
      }
      
      // Skip MOs with very small quantities (likely test runs or partial completions)
      // Focus on representative production runs with meaningful quantities
      if (moWorkCenter.totalQuantity < 5) {
        console.log(`Skipping MO ${moWorkCenter.productionId} ${moWorkCenter.workCenter} - quantity too small (${moWorkCenter.totalQuantity})`);
        continue;
      }
      
      moWorkCenter.totalHours = moWorkCenter.totalDurationSeconds / 3600;
      moWorkCenter.uphPerMO = moWorkCenter.totalQuantity / moWorkCenter.totalHours;
      
      // Only include realistic UPH values
      if (moWorkCenter.uphPerMO > 0 && moWorkCenter.uphPerMO < 1000 && isFinite(moWorkCenter.uphPerMO)) {
        productionOrderWorkCenters.push(moWorkCenter);
      }
    }

    console.log(`Calculated UPH for ${productionOrderWorkCenters.length} Production Order + Work Center combinations`);

    // Step 2: Aggregate with weighted averages per operator + routing + work center
    const operatorAggregation = new Map<string, {
      operatorName: string;
      operatorId: number;
      routing: string;
      workCenter: string;
      moWorkCenters: ProductionOrderWorkCenter[];
      totalObservations: number;
      weightedAverageUph: number;
      totalQuantity: number;
      totalHours: number;
    }>();

    for (const moWC of productionOrderWorkCenters) {
      const key = `${moWC.operatorName}|${moWC.routing}|${moWC.workCenter}`;
      
      if (!operatorAggregation.has(key)) {
        operatorAggregation.set(key, {
          operatorName: moWC.operatorName,
          operatorId: moWC.operatorId,
          routing: moWC.routing,
          workCenter: moWC.workCenter,
          moWorkCenters: [],
          totalObservations: 0,
          weightedAverageUph: 0,
          totalQuantity: 0,
          totalHours: 0
        });
      }

      const agg = operatorAggregation.get(key)!;
      agg.moWorkCenters.push(moWC);
      agg.totalObservations += moWC.totalCycleCount;
      agg.totalQuantity += moWC.totalQuantity;
      agg.totalHours += moWC.totalHours;
    }

    // Calculate weighted average UPH using cycle counts as weights
    for (const agg of operatorAggregation.values()) {
      if (agg.moWorkCenters.length === 0) continue;
      
      // Weighted average: sum(UPH * cycle_count) / sum(cycle_count)
      let weightedSum = 0;
      let totalWeight = 0;
      
      for (const moWC of agg.moWorkCenters) {
        weightedSum += moWC.uphPerMO * moWC.totalCycleCount;
        totalWeight += moWC.totalCycleCount;
      }
      
      agg.weightedAverageUph = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    // Filter out aggregations with too few observations
    const validAggregations = Array.from(operatorAggregation.values())
      .filter(agg => agg.totalObservations >= 3 && agg.moWorkCenters.length >= 1);

    console.log(`Created ${validAggregations.length} weighted average UPH records`);

    // Step 3: Clear and insert data
    console.log("Clearing existing historical UPH data...");
    await db.delete(historicalUph);

    let insertedCount = 0;
    
    for (const agg of validAggregations) {
      if (!agg.operatorName || !agg.routing || !agg.workCenter || 
          !agg.operatorId || isNaN(agg.operatorId) || agg.operatorId === 0 ||
          !isFinite(agg.weightedAverageUph) || agg.weightedAverageUph <= 0) {
        continue;
      }

      try {
        await db.insert(historicalUph).values({
          operatorId: agg.operatorId,
          operator: agg.operatorName,
          routing: agg.routing,
          workCenter: agg.workCenter,
          operation: `${agg.workCenter} Operations`,
          totalQuantity: agg.totalQuantity,
          totalHours: agg.totalHours,
          unitsPerHour: agg.weightedAverageUph,
          observations: agg.totalObservations,
          dataSource: 'individual_wo_weighted_average',
          lastCalculated: new Date()
        });

        insertedCount++;
        
        if (insertedCount % 25 === 0) {
          console.log(`Inserted ${insertedCount} weighted average UPH records...`);
        }

      } catch (error) {
        console.error(`Error inserting weighted UPH record for ${agg.operatorName}:`, error);
      }
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} weighted average UPH records`);
    
    // Show summary
    const summaryQuery = `
      SELECT 
        work_center,
        COUNT(*) as record_count,
        CAST(AVG(units_per_hour) AS DECIMAL(10,2)) as avg_uph,
        CAST(MIN(units_per_hour) AS DECIMAL(10,2)) as min_uph,
        CAST(MAX(units_per_hour) AS DECIMAL(10,2)) as max_uph,
        SUM(observations) as total_observations
      FROM historical_uph
      GROUP BY work_center
      ORDER BY avg_uph DESC
    `;

    const summary = await db.execute(summaryQuery);
    console.log("\n📊 Individual Work Order UPH Summary by Work Center:");
    console.table(summary);

    return {
      success: true,
      productionOrderWorkCenters: productionOrderWorkCenters.length,
      recordsInserted: insertedCount,
      summary: summary
    };

  } catch (error) {
    console.error("Error in individual work order UPH fix:", error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixUphIndividualWorkOrders()
    .then(result => {
      console.log("Individual work order UPH fix completed:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("Individual work order UPH fix failed:", error);
      process.exit(1);
    });
}

export { fixUphIndividualWorkOrders };