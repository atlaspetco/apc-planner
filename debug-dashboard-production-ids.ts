import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { FulfilCurrentService } from './server/fulfil-current.js';
import { gt, isNotNull, inArray, and } from "drizzle-orm";

async function debugDashboardProductionIds() {
  console.log("=== DEBUGGING DASHBOARD PRODUCTION IDS ===");
  
  // Get current dashboard production orders (same logic as assignments API)
  const fulfilService = new FulfilCurrentService();
  const manufacturingOrders = await fulfilService.getCurrentProductionOrders();
  
  console.log(`Found ${manufacturingOrders.length} manufacturing orders from Fulfil`);
  
  // Extract production order IDs from dashboard
  const dashboardProductionOrderIds = manufacturingOrders.map(mo => mo.id);
  console.log(`Dashboard production order IDs: ${dashboardProductionOrderIds.slice(0, 10).join(', ')}...`);
  console.log(`Total dashboard production IDs: ${dashboardProductionOrderIds.length}`);
  
  // Check what work cycles exist for these production IDs
  const workCyclesForDashboard = await db
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
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
    
  console.log(`Found ${workCyclesForDashboard.length} work cycles for dashboard production IDs`);
  
  if (workCyclesForDashboard.length > 0) {
    console.log("Sample work cycles found:", workCyclesForDashboard.slice(0, 5));
    
    // Calculate completed hours by operator
    const completedHoursByOperator = new Map<string, number>();
    workCyclesForDashboard.forEach(cycle => {
      if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
        const hours = cycle.duration / 3600;
        const currentHours = completedHoursByOperator.get(cycle.operatorName) || 0;
        completedHoursByOperator.set(cycle.operatorName, currentHours + hours);
      }
    });
    
    console.log(`Completed hours by operator:`);
    completedHoursByOperator.forEach((hours, operatorName) => {
      console.log(`  ${operatorName}: ${hours.toFixed(2)}h`);
    });
  } else {
    console.log("❌ NO WORK CYCLES FOUND - investigating...");
    
    // Check if there are any work cycles at all
    const allCycles = await db
      .select({
        productionId: workCycles.work_production_id,
        operatorName: workCycles.work_cycles_operator_rec_name,
        duration: workCycles.work_cycles_duration
      })
      .from(workCycles)
      .where(
        and(
          gt(workCycles.work_cycles_duration, 0),
          isNotNull(workCycles.work_cycles_duration),
          isNotNull(workCycles.work_cycles_operator_rec_name)
        )
      )
      .limit(20);
      
    console.log(`Total work cycles in database: ${allCycles.length}`);
    if (allCycles.length > 0) {
      console.log("Sample production IDs from work cycles:", allCycles.map(c => c.productionId).slice(0, 10));
      console.log("Sample work cycles:", allCycles.slice(0, 5));
      
      // Check if there's any overlap
      const workCycleProductionIds = [...new Set(allCycles.map(c => c.productionId))];
      const overlap = dashboardProductionOrderIds.filter(id => workCycleProductionIds.includes(id));
      console.log(`Overlap between dashboard and work cycles: ${overlap.length} production IDs`);
      console.log(`Overlapping IDs: ${overlap.slice(0, 10).join(', ')}`);
    }
  }
}

debugDashboardProductionIds().catch(console.error);