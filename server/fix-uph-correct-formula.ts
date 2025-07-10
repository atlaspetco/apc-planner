/**
 * Fix UPH calculations using CORRECT formula:
 * UPH = Work Order Quantity / Total Duration Hours
 * Sum duration across cycles for each work order, then divide WO quantity by total duration
 */

import { db } from "./db.js";
import { historicalUph, workCycles } from "../shared/schema.js";

interface CorrectUphData {
  operatorName: string;
  operatorId: number;
  routing: string;
  workCenterCategory: string;
  workOrderQuantity: number;
  totalDurationSeconds: number;
  totalHours: number;
  correctUph: number;
  cycleCount: number;
}

async function fixUphCorrectFormula() {
  console.log("Fixing UPH calculations using CORRECT formula: UPH = WO Quantity / Total Duration Hours");

  try {
    // Get all work cycles data
    const allCycles = await db.select().from(workCycles);
    console.log(`Retrieved ${allCycles.length} work cycles from database`);

    // Group by work order to sum durations and get quantities
    const workOrderMap = new Map<number, {
      operator: string;
      operatorId: number;
      routing: string;
      workCenter: string;
      quantity: number;
      totalDuration: number;
      cycleCount: number;
    }>();

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
        // Use work_cycles_quantity_done as the work order quantity
        const quantity = cycle.work_cycles_quantity_done || 1; // Default to 1 if null
        
        workOrderMap.set(workId, {
          operator: cycle.work_cycles_operator_rec_name,
          operatorId: cycle.work_cycles_operator_id || 0,
          routing: cycle.work_production_routing_rec_name,
          workCenter: workCenterCategory,
          quantity: quantity,
          totalDuration: 0,
          cycleCount: 0
        });
      }

      const workOrder = workOrderMap.get(workId)!;
      workOrder.totalDuration += cycle.work_cycles_duration;
      workOrder.cycleCount += 1;
    }

    // Calculate correct UPH for each work order
    const correctUphData: CorrectUphData[] = [];
    
    for (const [workId, workOrder] of workOrderMap) {
      if (workOrder.operatorId === 0 || workOrder.totalDuration === 0) continue;
      
      const totalHours = workOrder.totalDuration / 3600; // Convert seconds to hours
      const correctUph = workOrder.quantity / totalHours; // UPH = Quantity / Hours
      
      correctUphData.push({
        operatorName: workOrder.operator,
        operatorId: workOrder.operatorId,
        routing: workOrder.routing,
        workCenterCategory: workOrder.workCenter,
        workOrderQuantity: workOrder.quantity,
        totalDurationSeconds: workOrder.totalDuration,
        totalHours: totalHours,
        correctUph: correctUph,
        cycleCount: workOrder.cycleCount
      });
    }

    console.log(`Calculated correct UPH for ${correctUphData.length} work orders`);

    // Aggregate by operator + routing + work center for database storage
    const aggregationMap = new Map<string, {
      operatorName: string;
      operatorId: number;
      routing: string;
      workCenter: string;
      totalQuantity: number;
      totalHours: number;
      totalObservations: number;
      weightedUph: number;
    }>();

    for (const record of correctUphData) {
      const key = `${record.operatorName}|${record.routing}|${record.workCenterCategory}`;
      
      if (!aggregationMap.has(key)) {
        aggregationMap.set(key, {
          operatorName: record.operatorName,
          operatorId: record.operatorId,
          routing: record.routing,
          workCenter: record.workCenterCategory,
          totalQuantity: 0,
          totalHours: 0,
          totalObservations: 0,
          weightedUph: 0
        });
      }

      const agg = aggregationMap.get(key)!;
      agg.totalQuantity += record.workOrderQuantity;
      agg.totalHours += record.totalHours;
      agg.totalObservations += record.cycleCount;
    }

    // Calculate weighted average UPH for each aggregation
    for (const agg of aggregationMap.values()) {
      agg.weightedUph = agg.totalQuantity / agg.totalHours;
    }

    // Clear existing data
    console.log("Clearing existing historical UPH data...");
    await db.delete(historicalUph);

    // Insert correct UPH data
    let insertedCount = 0;
    let skippedCount = 0;
    
    for (const record of aggregationMap.values()) {
      // Validate required fields
      if (!record.operatorName || !record.routing || !record.workCenter || 
          !record.operatorId || isNaN(record.operatorId) || record.operatorId === 0 ||
          record.totalHours <= 0 || !isFinite(record.weightedUph)) {
        skippedCount++;
        continue;
      }

      try {
        await db.insert(historicalUph).values({
          operatorId: record.operatorId,
          operator: record.operatorName,
          routing: record.routing,
          workCenter: record.workCenter,
          operation: `${record.workCenter} Operations`,
          totalQuantity: record.totalQuantity,
          totalHours: record.totalHours,
          unitsPerHour: record.weightedUph, // Correct UPH = Quantity / Hours
          observations: record.totalObservations,
          dataSource: 'correct_formula_quantity_per_hour',
          lastCalculated: new Date()
        });

        insertedCount++;
        
        if (insertedCount % 25 === 0) {
          console.log(`Inserted ${insertedCount} correct UPH records...`);
        }

      } catch (error) {
        console.error(`Error inserting correct UPH record for ${record.operatorName}:`, error);
        skippedCount++;
      }
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} correct UPH records, skipped ${skippedCount} invalid records`);
    
    // Show summary
    const summaryQuery = `
      SELECT 
        work_center,
        COUNT(*) as record_count,
        AVG(units_per_hour) as avg_uph,
        MIN(units_per_hour) as min_uph,
        MAX(units_per_hour) as max_uph,
        SUM(observations) as total_observations
      FROM historical_uph
      GROUP BY work_center
      ORDER BY work_center
    `;

    const summary = await db.execute(summaryQuery);
    console.log("\n📊 Correct UPH Summary by Work Center Category:");
    console.table(summary);

    return {
      success: true,
      workOrdersProcessed: correctUphData.length,
      recordsInserted: insertedCount,
      summary: summary
    };

  } catch (error) {
    console.error("Error in correct UPH formula fix:", error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixUphCorrectFormula()
    .then(result => {
      console.log("Correct UPH formula fix completed:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("Correct UPH formula fix failed:", error);
      process.exit(1);
    });
}

export { fixUphCorrectFormula };