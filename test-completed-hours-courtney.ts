#!/usr/bin/env tsx

/**
 * Test script to check completed hours calculation for Courtney Banh
 * Should find 12m 24sec from MO203104 (as mentioned by user)
 */

import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { isNotNull, gt, and, like } from "drizzle-orm";

async function testCourtneyCompletedHours() {
  console.log("=== Testing Courtney Banh Completed Hours ===");
  
  // First, find all work cycles for Courtney
  const courtneyWorkCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      productionId: workCycles.work_production_id,
      productionNumber: workCycles.work_production_number,
      duration: workCycles.work_cycles_duration,
      state: workCycles.state,
      workCenter: workCycles.work_cycles_work_center_rec_name,
      quantity: workCycles.work_cycles_quantity_done,
      createDate: workCycles.work_production_create_date
    })
    .from(workCycles)
    .where(
      and(
        like(workCycles.work_cycles_operator_rec_name, "%Courtney%"),
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration)
      )
    );
  
  console.log(`Found ${courtneyWorkCycles.length} work cycles for Courtney`);
  
  // Look specifically for MO203104 or production ID 203104
  const mo203104Cycles = courtneyWorkCycles.filter(cycle => 
    cycle.productionNumber?.includes("203104") || 
    cycle.productionId === 203104
  );
  
  console.log(`Found ${mo203104Cycles.length} work cycles for MO203104`);
  if (mo203104Cycles.length > 0) {
    console.log("MO203104 cycles:", mo203104Cycles);
    
    const totalDuration = mo203104Cycles.reduce((sum, cycle) => sum + (cycle.duration || 0), 0);
    const totalHours = totalDuration / 3600;
    const totalMinutes = totalDuration / 60;
    
    console.log(`MO203104 total duration: ${totalDuration} seconds = ${totalMinutes.toFixed(1)} minutes = ${totalHours.toFixed(3)} hours`);
  }
  
  // Show all recent work cycles for Courtney
  console.log("\n=== Recent Courtney Work Cycles ===");
  const recentCycles = courtneyWorkCycles
    .sort((a, b) => (b.createDate?.getTime() || 0) - (a.createDate?.getTime() || 0))
    .slice(0, 10);
  
  recentCycles.forEach((cycle, i) => {
    const minutes = (cycle.duration || 0) / 60;
    console.log(`${i + 1}. MO: ${cycle.productionNumber}, Duration: ${minutes.toFixed(1)}min, Work Center: ${cycle.workCenter}, Date: ${cycle.createDate?.toISOString().split('T')[0]}`);
  });
  
  // Calculate total completed hours for Courtney from all cycles
  const totalCompletedHours = courtneyWorkCycles.reduce((sum, cycle) => {
    return sum + (cycle.duration || 0) / 3600;
  }, 0);
  
  console.log(`\nCourtney's total completed hours: ${totalCompletedHours.toFixed(2)}h`);
  
  // Check if any cycles are for current dashboard MOs (starting with 203xxx or 206xxx based on logs)
  const dashboardMoCycles = courtneyWorkCycles.filter(cycle => {
    const moNumber = cycle.productionNumber || '';
    return moNumber.includes('203') || moNumber.includes('206') || moNumber.includes('204');
  });
  
  console.log(`\nDashboard MO cycles for Courtney: ${dashboardMoCycles.length}`);
  if (dashboardMoCycles.length > 0) {
    const dashboardHours = dashboardMoCycles.reduce((sum, cycle) => sum + (cycle.duration || 0) / 3600, 0);
    console.log(`Dashboard completed hours: ${dashboardHours.toFixed(3)}h`);
    console.log("Sample dashboard cycles:", dashboardMoCycles.slice(0, 5));
  }
}

testCourtneyCompletedHours().catch(console.error);