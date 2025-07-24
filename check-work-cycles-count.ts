import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function checkWorkCyclesCount() {
  try {
    const result = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    console.log(`Current work cycles in database: ${result[0].count}`);
    
    // Get sample of latest cycles
    const latestCycles = await db.select({
      id: workCycles.work_cycles_id,
      operator: workCycles.work_cycles_operator_rec_name,
      workCenter: workCycles.work_cycles_work_center_rec_name,
      moNumber: workCycles.work_production_number
    })
    .from(workCycles)
    .orderBy(sql`${workCycles.work_cycles_id} DESC`)
    .limit(5);
    
    console.log("\nLatest 5 work cycles:");
    latestCycles.forEach(cycle => {
      console.log(`  ID: ${cycle.id}, Operator: ${cycle.operator}, Work Center: ${cycle.workCenter}, MO: ${cycle.moNumber}`);
    });
    
  } catch (error) {
    console.error("Error:", error);
  }
  process.exit(0);
}

checkWorkCyclesCount();