import { sql } from "drizzle-orm";
import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";

/**
 * This script demonstrates the UPH calculation issue and the fix
 */
async function demonstrateUphIssue() {
  console.log("🔍 Demonstrating UPH Calculation Issue\n");
  
  try {
    // Get a sample of work cycles to show the issue
    const sampleCycles = await db.execute(sql`
      SELECT 
        work_production_number as mo_number,
        work_production_quantity as mo_quantity,
        work_cycles_quantity_done as cycle_quantity,
        work_cycles_duration as duration_seconds,
        work_cycles_operator_rec_name as operator,
        work_cycles_work_center_rec_name as work_center,
        work_production_routing_rec_name as routing
      FROM work_cycles
      WHERE state = 'done'
        AND work_production_quantity > 0
        AND work_cycles_duration > 0
        AND work_production_number IS NOT NULL
      ORDER BY work_production_number, work_cycles_id
      LIMIT 20
    `);
    
    console.log(`Found ${sampleCycles.rows.length} sample work cycles\n`);
    
    // Group by MO to show the issue
    const moGroups = new Map<string, any>();
    
    for (const cycle of sampleCycles.rows) {
      const moNumber = cycle.mo_number?.toString() || '';
      if (!moGroups.has(moNumber)) {
        moGroups.set(moNumber, {
          moNumber,
          moQuantity: parseFloat(cycle.mo_quantity?.toString() || '0'),
          operator: cycle.operator,
          workCenter: cycle.work_center,
          routing: cycle.routing,
          cycles: []
        });
      }
      
      moGroups.get(moNumber)!.cycles.push({
        cycleQuantity: parseFloat(cycle.cycle_quantity?.toString() || '0'),
        durationSeconds: parseFloat(cycle.duration_seconds?.toString() || '0')
      });
    }
    
    // Show the calculation difference
    console.log("📊 Comparing UPH Calculation Methods:\n");
    
    for (const [moNumber, data] of moGroups) {
      console.log(`MO: ${moNumber}`);
      console.log(`Operator: ${data.operator} | Work Center: ${data.workCenter}`);
      console.log(`MO Quantity: ${data.moQuantity} units`);
      
      // Calculate using WRONG method (sum of cycle quantities)
      const totalCycleQuantity = data.cycles.reduce((sum: number, c: any) => sum + c.cycleQuantity, 0);
      const totalDurationSeconds = data.cycles.reduce((sum: number, c: any) => sum + c.durationSeconds, 0);
      const totalHours = totalDurationSeconds / 3600;
      
      const wrongUph = totalCycleQuantity / totalHours;
      const correctUph = data.moQuantity / totalHours;
      
      console.log(`\n  ❌ WRONG Method (sum of cycle quantities):`);
      console.log(`     Total Cycle Quantity: ${totalCycleQuantity.toFixed(0)} units`);
      console.log(`     UPH = ${totalCycleQuantity.toFixed(0)} / ${totalHours.toFixed(2)}h = ${wrongUph.toFixed(2)} UPH`);
      
      console.log(`\n  ✅ CORRECT Method (MO quantity):`);
      console.log(`     MO Quantity: ${data.moQuantity} units`);
      console.log(`     UPH = ${data.moQuantity} / ${totalHours.toFixed(2)}h = ${correctUph.toFixed(2)} UPH`);
      
      const difference = Math.abs(correctUph - wrongUph);
      const percentDiff = (difference / correctUph * 100).toFixed(1);
      
      console.log(`\n  📈 Difference: ${difference.toFixed(2)} UPH (${percentDiff}% ${wrongUph > correctUph ? 'overestimated' : 'underestimated'})`);
      console.log(`  Cycles in this MO: ${data.cycles.length}`);
      console.log("  " + "─".repeat(60) + "\n");
    }
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateUphIssue();
}