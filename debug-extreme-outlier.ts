import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function debugExtremeOutlier() {
  console.log("🔍 Investigating MO173767 - The 14,400 UPH outlier");

  // Get all work cycles for this specific MO
  const cycles = await db.execute(sql`
    SELECT 
      work_cycles_id as cycle_id,
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center,
      work_production_routing_rec_name as routing,
      work_production_number as mo_number,
      work_production_quantity as mo_quantity,
      work_cycles_duration as duration_seconds,
      work_cycles_quantity_done as cycle_quantity,
      work_operation_rec_name as operation,
      updated_at,
      created_at
    FROM work_cycles 
    WHERE work_production_number = 'MO173767'
    ORDER BY work_cycles_id
  `);

  console.log(`\n📊 Found ${cycles.rows.length} work cycles for MO173767:`);
  
  let totalDuration = 0;
  let totalCycleQuantity = 0;
  
  cycles.rows.forEach((cycle, index) => {
    const duration = parseFloat(cycle.duration_seconds);
    const quantity = parseFloat(cycle.cycle_quantity);
    const moQuantity = parseFloat(cycle.mo_quantity);
    
    totalDuration += duration;
    totalCycleQuantity += quantity;
    
    console.log(`${index + 1}. Cycle ${cycle.cycle_id}:`);
    console.log(`   - Operator: ${cycle.operator_name}`);
    console.log(`   - Work Center: ${cycle.work_center}`);
    console.log(`   - Operation: ${cycle.operation}`);
    console.log(`   - Duration: ${duration}s (${(duration/3600).toFixed(4)}h)`);
    console.log(`   - Cycle Quantity Done: ${quantity}`);
    console.log(`   - MO Total Quantity: ${moQuantity}`);
    console.log(`   - Created: ${cycle.created_at}`);
    console.log(`   - Updated: ${cycle.updated_at}`);
  });
  
  const totalHours = totalDuration / 3600;
  const moQuantity = cycles.rows[0] ? parseFloat(cycles.rows[0].mo_quantity) : 0;
  const calculatedUph = moQuantity / totalHours;
  
  console.log(`\n🎯 ANALYSIS:`);
  console.log(`   MO Quantity: ${moQuantity} units`);
  console.log(`   Total Duration: ${totalDuration}s (${totalHours.toFixed(4)}h)`);  
  console.log(`   Total Cycle Quantity: ${totalCycleQuantity}`);
  console.log(`   Calculated UPH: ${calculatedUph.toFixed(2)}`);
  
  // Check if this is a timing issue
  if (totalDuration < 60) {
    console.log(`\n⚠️  PROBLEM IDENTIFIED: Duration of ${totalDuration}s is suspiciously short`);
    console.log(`   This suggests either:`);
    console.log(`   1. Incorrect time recording (clock not started/stopped properly)`);
    console.log(`   2. Data entry error in duration field`);
    console.log(`   3. Work cycle was not actually completed`);
  }
  
  if (totalCycleQuantity !== moQuantity) {
    console.log(`\n⚠️  QUANTITY MISMATCH: Cycle quantities (${totalCycleQuantity}) != MO quantity (${moQuantity})`);
  }

  process.exit(0);
}

debugExtremeOutlier();