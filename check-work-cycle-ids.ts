#!/usr/bin/env tsx

import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function checkWorkCycleIds() {
  console.log("=== Work Cycle Database Analysis ===");
  
  // Get total count
  const totalCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
  console.log(`Total work cycles in database: ${totalCount[0].count}`);
  
  // Get ID range
  const idStats = await db.select({
    minId: sql<number>`min(id)`,
    maxId: sql<number>`max(id)`
  }).from(workCycles);
  
  console.log(`ID range: ${idStats[0].minId} to ${idStats[0].maxId}`);
  console.log(`Next import would start from ID: ${(idStats[0].maxId || 0) + 1}`);
  
  // Check recent cycles by ID
  console.log("\n=== Recent Work Cycles by ID ===");
  const recentByIds = await db
    .select({
      id: workCycles.id,
      operatorName: workCycles.work_cycles_operator_rec_name,
      productionId: workCycles.work_production_id,
      productionNumber: workCycles.work_production_number,
      duration: workCycles.work_cycles_duration
    })
    .from(workCycles)
    .orderBy(workCycles.id, 'desc')
    .limit(10);
    
  recentByIds.forEach((cycle, index) => {
    const durationMin = cycle.duration ? (cycle.duration / 60).toFixed(1) : 'N/A';
    console.log(`${index + 1}. ID: ${cycle.id}, Operator: ${cycle.operatorName}, Production: ${cycle.productionId}, MO: ${cycle.productionNumber}, Duration: ${durationMin}min`);
  });
  
  // Look for specific patterns
  const courtneyCount = await db.select({ count: sql<number>`count(*)` })
    .from(workCycles)
    .where(sql`work_cycles_operator_rec_name LIKE '%Courtney%'`);
  
  console.log(`\n=== Courtney Banh Work Cycles ===`);
  console.log(`Total Courtney cycles: ${courtneyCount[0].count}`);
  
  // Check if we have any recent production IDs matching dashboard
  const dashboardIds = [195859, 195468, 195340, 195331, 195329, 195326];
  const matchingCycles = await db.select({ count: sql<number>`count(*)` })
    .from(workCycles)
    .where(sql`work_production_id IN (${sql.join(dashboardIds.map(id => sql`${id}`), sql`, `)})`);
    
  console.log(`\nWork cycles matching dashboard production orders: ${matchingCycles[0].count}`);
}

checkWorkCycleIds().catch(console.error);