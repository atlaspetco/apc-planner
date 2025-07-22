import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function debugMO21262() {
  console.log("🔍 Analyzing MO21262 structure as described by user");

  // First check if WO17624 exists (mentioned by user)
  const wo17624Check = await db.execute(sql`
    SELECT 
      work_production_number,
      work_id,
      work_cycles_duration,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_operation_rec_name
    FROM work_cycles 
    WHERE work_id = 17624
  `);
  console.log(`WO17624 cycles found: ${wo17624Check.rows.length}`);
  if (wo17624Check.rows.length > 0) {
    const wo = wo17624Check.rows[0];
    console.log(`WO17624 details: MO=${wo.work_production_number}, duration=${wo.work_cycles_duration}s, operator=${wo.work_cycles_operator_rec_name}, work_center=${wo.work_cycles_work_center_rec_name}`);
  }

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
      work_id as work_order_id
    FROM work_cycles 
    WHERE work_production_number = 'MO21262'
    ORDER BY work_id, work_cycles_id
  `);

  console.log(`\n📊 Found ${cycles.rows.length} work cycles for MO21262:`);
  
  // Group by work order
  const workOrders = new Map();
  
  cycles.rows.forEach((cycle) => {
    const workOrderId = cycle.work_order_id;
    const duration = parseFloat(cycle.duration_seconds);
    const quantity = parseFloat(cycle.cycle_quantity);
    const moQuantity = parseFloat(cycle.mo_quantity);
    
    if (!workOrders.has(workOrderId)) {
      workOrders.set(workOrderId, {
        workOrderId,
        operator: cycle.operator_name,
        workCenter: cycle.work_center,
        operation: cycle.operation,
        cycles: [],
        totalDuration: 0,
        totalQuantity: 0,
        moQuantity
      });
    }
    
    const wo = workOrders.get(workOrderId);
    wo.cycles.push({
      cycleId: cycle.cycle_id,
      duration,
      quantity,
      operation: cycle.operation
    });
    wo.totalDuration += duration;
    wo.totalQuantity += quantity;
  });

  console.log(`\n🎯 Work Order Breakdown:`);
  let totalMoDuration = 0;
  
  workOrders.forEach((wo, woId) => {
    const hours = wo.totalDuration / 3600;
    totalMoDuration += wo.totalDuration;
    
    console.log(`\nWO${woId}: ${wo.operator} | ${wo.workCenter}`);
    console.log(`  - Operation: ${wo.operation}`);
    console.log(`  - Cycles: ${wo.cycles.length}`);
    console.log(`  - Duration: ${wo.totalDuration}s (${hours.toFixed(4)}h)`);
    console.log(`  - Cycle Quantity: ${wo.totalQuantity}`);
    
    wo.cycles.forEach((cycle, index) => {
      const cycleHours = cycle.duration / 3600;
      console.log(`    ${index + 1}. Cycle ${cycle.cycleId}: ${cycle.duration}s (${cycleHours.toFixed(4)}h), qty: ${cycle.quantity}`);
    });
  });
  
  const totalHours = totalMoDuration / 3600;
  const moQuantity = cycles.rows[0] ? parseFloat(cycles.rows[0].mo_quantity) : 0;
  const correctUph = moQuantity / totalHours;
  
  console.log(`\n🎯 MO21262 ANALYSIS:`);
  console.log(`   MO Quantity: ${moQuantity} units`);
  console.log(`   Total MO Duration: ${totalMoDuration}s (${totalHours.toFixed(4)}h)`);  
  console.log(`   Correct UPH: ${correctUph.toFixed(3)}`);
  console.log(`   User Expected: ~15.061 UPH`);

  process.exit(0);
}

debugMO21262();