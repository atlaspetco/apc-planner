import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql } from "drizzle-orm";

async function checkWorkCyclesFields() {
  console.log("=== Checking Work Cycles Fields ===");
  
  // Get a sample of work cycles to see all fields
  const sampleCycles = await db.select().from(workCycles).limit(5);
  
  console.log("\nSample work cycles:");
  sampleCycles.forEach((cycle, idx) => {
    console.log(`\n--- Cycle ${idx + 1} ---`);
    Object.entries(cycle).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }
    });
  });
  
  // Check if we have work_cycles_work_id field populated
  const cyclesWithWorkId = await db.select({
    count: sql<number>`count(*)`
  }).from(workCycles)
  .where(sql`${workCycles.work_cycles_work_id} IS NOT NULL`);
  
  console.log(`\nCycles with work_cycles_work_id populated: ${cyclesWithWorkId[0].count}`);
  
  // Check a sample of cycles with work IDs
  const sampleWithWorkId = await db.select({
    workId: workCycles.work_cycles_work_id,
    workNumber: workCycles.work_cycles_work_number,
    operatorName: workCycles.work_cycles_operator_rec_name,
    duration: workCycles.work_cycles_duration,
    moNumber: workCycles.work_production_number
  }).from(workCycles)
  .where(sql`${workCycles.work_cycles_work_id} IS NOT NULL`)
  .limit(10);
  
  console.log("\nSample cycles with work IDs:");
  sampleWithWorkId.forEach(c => {
    const hours = (c.duration || 0) / 3600;
    console.log(`  Work ID: ${c.workId}, WO#: ${c.workNumber}, MO#: ${c.moNumber}, Operator: ${c.operatorName}, Duration: ${hours.toFixed(2)}h`);
  });
  
  process.exit(0);
}

checkWorkCyclesFields().catch(console.error);
