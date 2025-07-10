/**
 * Fix UPH calculations - calculate each work order individually, then weighted average per operator
 * UPH = Work Order Quantity / Total Duration Hours (per individual work order)
 * Then aggregate with weighted averages based on observations per operator
 */

import { db } from "./db.js";
import { historicalUph, workCycles } from "../shared/schema.js";

interface IndividualWorkOrder {
  workId: number;
  operatorName: string;
  operatorId: number;
  routing: string;
  workCenter: string;
  quantity: number;
  totalDurationSeconds: number;
  totalHours: number;
  uphPerWorkOrder: number;
  cycleCount: number;
}

async function fixUphIndividualWorkOrders() {
  console.log("Calculating UPH for each individual work order, then weighted averaging per operator...");

  try {
    const allCycles = await db.select().from(workCycles);
    console.log(`Retrieved ${allCycles.length} work cycles from database`);

    // Step 1: Calculate UPH for each individual work order
    const workOrderMap = new Map<number, IndividualWorkOrder>();

    for (const cycle of allCycles) {
      if (!cycle.work_id || 
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

      const workId = cycle.work_id;
      
      if (!workOrderMap.has(workId)) {
        workOrderMap.set(workId, {
          workId: workId,
          operatorName: cycle.work_cycles_operator_rec_name,
          operatorId: cycle.work_cycles_operator_id || 0,
          routing: cycle.work_production_routing_rec_name,
          workCenter: workCenterCategory,
          quantity: 0, // Will be calculated as max quantity across all cycles
          totalDurationSeconds: 0,
          totalHours: 0,
          uphPerWorkOrder: 0,
          cycleCount: 0
        });
      }

      const workOrder = workOrderMap.get(workId)!;
      workOrder.totalDurationSeconds += cycle.work_cycles_duration;
      workOrder.cycleCount += 1;
      
      // Use the maximum quantity_done across all cycles for this work order
      // This handles cases where some cycles have 0 quantity but others have the actual quantity
      if (cycle.work_cycles_quantity_done && cycle.work_cycles_quantity_done > workOrder.quantity) {
        workOrder.quantity = cycle.work_cycles_quantity_done;
      }
    }

    // Calculate UPH for each individual work order
    const individualWorkOrders: IndividualWorkOrder[] = [];
    
    for (const workOrder of workOrderMap.values()) {
      if (workOrder.operatorId === 0 || workOrder.totalDurationSeconds === 0) continue;
      
      // Skip work orders with no quantity data (can't calculate UPH)
      if (workOrder.quantity === 0) {
        console.log(`Skipping work order ${workOrder.workId} - no quantity data`);
        continue;
      }
      
      // Skip work orders with very small quantities (likely test runs or partial completions)
      // Focus on representative production runs with meaningful quantities
      if (workOrder.quantity < 5) {
        console.log(`Skipping work order ${workOrder.workId} - quantity too small (${workOrder.quantity})`);
        continue;
      }
      
      workOrder.totalHours = workOrder.totalDurationSeconds / 3600;
      workOrder.uphPerWorkOrder = workOrder.quantity / workOrder.totalHours;
      
      // Only include realistic UPH values
      if (workOrder.uphPerWorkOrder > 0 && workOrder.uphPerWorkOrder < 1000 && isFinite(workOrder.uphPerWorkOrder)) {
        individualWorkOrders.push(workOrder);
      }
    }

    console.log(`Calculated UPH for ${individualWorkOrders.length} individual work orders`);

    // Step 2: Aggregate with weighted averages per operator + routing + work center
    const operatorAggregation = new Map<string, {
      operatorName: string;
      operatorId: number;
      routing: string;
      workCenter: string;
      workOrders: IndividualWorkOrder[];
      totalObservations: number;
      weightedAverageUph: number;
      totalQuantity: number;
      totalHours: number;
    }>();

    for (const wo of individualWorkOrders) {
      const key = `${wo.operatorName}|${wo.routing}|${wo.workCenter}`;
      
      if (!operatorAggregation.has(key)) {
        operatorAggregation.set(key, {
          operatorName: wo.operatorName,
          operatorId: wo.operatorId,
          routing: wo.routing,
          workCenter: wo.workCenter,
          workOrders: [],
          totalObservations: 0,
          weightedAverageUph: 0,
          totalQuantity: 0,
          totalHours: 0
        });
      }

      const agg = operatorAggregation.get(key)!;
      agg.workOrders.push(wo);
      agg.totalObservations += wo.cycleCount;
      agg.totalQuantity += wo.quantity;
      agg.totalHours += wo.totalHours;
    }

    // Calculate weighted average UPH using observations as weights
    for (const agg of operatorAggregation.values()) {
      if (agg.workOrders.length === 0) continue;
      
      // Weighted average: sum(UPH * observations) / sum(observations)
      let weightedSum = 0;
      let totalWeight = 0;
      
      for (const wo of agg.workOrders) {
        weightedSum += wo.uphPerWorkOrder * wo.cycleCount;
        totalWeight += wo.cycleCount;
      }
      
      agg.weightedAverageUph = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    // Filter out aggregations with too few observations
    const validAggregations = Array.from(operatorAggregation.values())
      .filter(agg => agg.totalObservations >= 3 && agg.workOrders.length >= 1);

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
      individualWorkOrders: individualWorkOrders.length,
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