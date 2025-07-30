import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { and, gt, isNotNull, inArray } from "drizzle-orm";

async function debugCourtneyCycles() {
  console.log("=== DEBUGGING COURTNEY'S COMPLETED CYCLES ===");
  
  // First, get dashboard production order IDs (same as assignments API)
  const dashboardMOs = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber
    })
    .from(productionOrders)
    .where(isNotNull(productionOrders.moNumber));
  
  const dashboardProductionOrderIds = dashboardMOs.map(mo => mo.id);
  console.log(`Dashboard has ${dashboardProductionOrderIds.length} production orders`);
  
  // Check Courtney's work cycles with exact same query as assignments API
  console.log("\n1. Testing exact assignments API query for Courtney...");
  const assignmentsApiQuery = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      duration: workCycles.work_cycles_duration,
      productionId: workCycles.work_production_id,
      moNumber: workCycles.work_production_number
    })
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        isNotNull(workCycles.work_cycles_operator_rec_name),
        isNotNull(workCycles.work_production_number),
        inArray(workCycles.work_production_id, dashboardProductionOrderIds)
      )
    );
  
  const courtneyCycles = assignmentsApiQuery.filter(c => 
    c.operatorName?.includes("Courtney") || c.operatorName?.includes("Banh")
  );
  
  console.log(`Found ${courtneyCycles.length} Courtney cycles from assignments API query`);
  if (courtneyCycles.length > 0) {
    const totalHours = courtneyCycles.reduce((sum, c) => sum + (c.duration || 0) / 3600, 0);
    console.log(`Courtney's total completed hours: ${totalHours.toFixed(4)}h (${(totalHours * 60).toFixed(1)} minutes)`);
    console.log("Sample cycles:", courtneyCycles.slice(0, 3));
  }
  
  // Check raw Courtney cycles without production ID filter
  console.log("\n2. Testing Courtney cycles without dashboard filter...");
  const allCourtneyCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      duration: workCycles.work_cycles_duration,
      productionId: workCycles.work_production_id,
      moNumber: workCycles.work_production_number
    })
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        isNotNull(workCycles.work_cycles_operator_rec_name)
      )
    );
  
  const allCourtneyMatches = allCourtneyCycles.filter(c => 
    c.operatorName?.includes("Courtney") || c.operatorName?.includes("Banh")
  );
  
  console.log(`Found ${allCourtneyMatches.length} total Courtney cycles (no filter)`);
  if (allCourtneyMatches.length > 0) {
    console.log("Sample operator names:", [...new Set(allCourtneyMatches.map(c => c.operatorName))]);
    console.log("Sample MO numbers:", [...new Set(allCourtneyMatches.map(c => c.moNumber))].slice(0, 5));
    
    // Check which MOs match dashboard
    const courtneyDashboardMOs = allCourtneyMatches.filter(c => 
      dashboardProductionOrderIds.includes(c.productionId)
    );
    console.log(`Of these, ${courtneyDashboardMOs.length} are from dashboard MOs`);
    
    if (courtneyDashboardMOs.length > 0) {
      const dashboardHours = courtneyDashboardMOs.reduce((sum, c) => sum + (c.duration || 0) / 3600, 0);
      console.log(`Dashboard MO completed hours: ${dashboardHours.toFixed(4)}h (${(dashboardHours * 60).toFixed(1)} minutes)`);
      console.log("Dashboard MO numbers:", [...new Set(courtneyDashboardMOs.map(c => c.moNumber))]);
    }
  }
  
  process.exit(0);
}

debugCourtneyCycles().catch(console.error);