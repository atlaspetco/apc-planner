/**
 * Fix UPH calculations using AUTHENTIC work cycles data
 * Uses actual cycle counts and durations, not artificial estimates
 */

import { db } from "./db.js";
import { historicalUph, workCycles } from "../shared/schema.js";

interface AuthenticUphData {
  operatorName: string;
  operatorId: number;
  routing: string;
  workCenterCategory: string;
  totalCycles: number;
  totalDurationSeconds: number;
  totalHours: number;
  actualCyclesPerHour: number;
}

async function fixUphAuthentic() {
  console.log("Fixing UPH calculations using AUTHENTIC work cycles data...");

  try {
    // Get all work cycles data
    const allCycles = await db.select().from(workCycles);
    console.log(`Retrieved ${allCycles.length} work cycles from database`);

    // Aggregate by operator + routing + work center category
    const aggregationMap = new Map<string, AuthenticUphData>();

    for (const cycle of allCycles) {
      if (!cycle.work_cycles_operator_rec_name || 
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

      const key = `${cycle.work_cycles_operator_rec_name}|${cycle.work_production_routing_rec_name}|${workCenterCategory}`;
      
      if (!aggregationMap.has(key)) {
        aggregationMap.set(key, {
          operatorName: cycle.work_cycles_operator_rec_name,
          operatorId: cycle.work_cycles_operator_id || 0,
          routing: cycle.work_production_routing_rec_name,
          workCenterCategory,
          totalCycles: 0,
          totalDurationSeconds: 0,
          totalHours: 0,
          actualCyclesPerHour: 0
        });
      }

      const agg = aggregationMap.get(key)!;
      agg.totalCycles += 1;
      agg.totalDurationSeconds += cycle.work_cycles_duration;
    }

    // Calculate actual cycles per hour for each aggregation
    const authenticData = Array.from(aggregationMap.values())
      .filter(agg => agg.totalCycles >= 3)
      .map(agg => {
        agg.totalHours = agg.totalDurationSeconds / 3600;
        agg.actualCyclesPerHour = agg.totalCycles / agg.totalHours;
        return agg;
      });

    console.log(`Processed ${authenticData.length} authentic operator/routing/work-center combinations`);

    // Clear existing data
    console.log("Clearing existing historical UPH data...");
    await db.delete(historicalUph);

    // Insert authentic UPH data
    let insertedCount = 0;
    let skippedCount = 0;
    
    for (const record of authenticData) {
      // Validate required fields
      if (!record.operatorName || !record.routing || !record.workCenterCategory || 
          record.workCenterCategory === 'Unknown' ||
          !record.operatorId || isNaN(record.operatorId) || record.operatorId === 0 ||
          record.totalHours <= 0) {
        skippedCount++;
        continue;
      }

      try {
        await db.insert(historicalUph).values({
          operatorId: record.operatorId,
          operator: record.operatorName,
          routing: record.routing,
          workCenter: record.workCenterCategory,
          operation: `${record.workCenterCategory} Operations`,
          totalQuantity: record.totalCycles, // Use actual cycle count as quantity
          totalHours: record.totalHours,
          unitsPerHour: record.actualCyclesPerHour, // Use actual cycles per hour
          observations: record.totalCycles,
          dataSource: 'authentic_work_cycles',
          lastCalculated: new Date()
        });

        insertedCount++;
        
        if (insertedCount % 25 === 0) {
          console.log(`Inserted ${insertedCount} authentic UPH records...`);
        }

      } catch (error) {
        console.error(`Error inserting authentic UPH record for ${record.operatorName}:`, error);
        skippedCount++;
      }
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} authentic UPH records, skipped ${skippedCount} invalid records`);
    
    // Show summary
    const summaryQuery = `
      SELECT 
        work_center,
        COUNT(*) as record_count,
        AVG(units_per_hour) as avg_cycles_per_hour,
        MIN(units_per_hour) as min_cycles_per_hour,
        MAX(units_per_hour) as max_cycles_per_hour,
        SUM(observations) as total_observations
      FROM historical_uph
      GROUP BY work_center
      ORDER BY work_center
    `;

    const summary = await db.execute(summaryQuery);
    console.log("\n📊 Authentic UPH Summary by Work Center Category:");
    console.table(summary);

    return {
      success: true,
      recordsProcessed: authenticData.length,
      recordsInserted: insertedCount,
      summary: summary
    };

  } catch (error) {
    console.error("Error in authentic UPH fix:", error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixUphAuthentic()
    .then(result => {
      console.log("Authentic UPH fix completed:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("Authentic UPH fix failed:", error);
      process.exit(1);
    });
}

export { fixUphAuthentic };