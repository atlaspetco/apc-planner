import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql, eq, or, and, gt, isNotNull } from "drizzle-orm";

async function checkCompletedCycles() {
  console.log("=== Checking Completed Work Cycles ===");
  
  // First check total work cycles
  const totalCycles = await db.select({
    count: sql<number>`count(*)`
  }).from(workCycles);
  console.log(`Total work cycles: ${totalCycles[0].count}`);
  
  // Check cycles by state
  const stateCount = await db.select({
    state: workCycles.state,
    count: sql<number>`count(*)`
  }).from(workCycles)
  .groupBy(workCycles.state);
  
  console.log("\nWork cycles by state:");
  stateCount.forEach(s => console.log(`  ${s.state || 'NULL'}: ${s.count}`));
  
  // Check completed cycles (done/finished states)
  const completedCycles = await db.select({
    recName: workCycles.work_cycles_rec_name,
    operatorName: workCycles.work_cycles_operator_rec_name,
    duration: workCycles.work_cycles_duration,
    state: workCycles.state,
    workOrderId: sql<number>`CAST(NULLIF(REGEXP_REPLACE(${workCycles.work_cycles_rec_name}, 'WO([0-9]+).*', '\\1'), '') AS INTEGER)`
  }).from(workCycles)
  .where(
    and(
      gt(workCycles.work_cycles_duration, 0),
      isNotNull(workCycles.work_cycles_duration),
      or(
        eq(workCycles.state, 'done'),
        eq(workCycles.state, 'finished')
      )
    )
  )
  .limit(10);
  
  console.log(`\nFound ${completedCycles.length} completed cycles (done/finished with duration > 0):`);
  completedCycles.forEach(c => {
    const hours = (c.duration || 0) / 3600;
    console.log(`  ${c.recName} - ${c.operatorName} - ${hours.toFixed(2)}h - State: ${c.state} - WO ID: ${c.workOrderId}`);
  });
  
  // Check Devin Cann specifically
  const devinCycles = await db.select({
    recName: workCycles.work_cycles_rec_name,
    duration: workCycles.work_cycles_duration,
    state: workCycles.state,
    quantityDone: workCycles.work_cycles_quantity_done
  }).from(workCycles)
  .where(
    sql`${workCycles.work_cycles_operator_rec_name} LIKE '%Devin Cann%'`
  )
  .limit(10);
  
  console.log(`\n=== Devin Cann's Work Cycles (sample) ===`);
  devinCycles.forEach(c => {
    const hours = (c.duration || 0) / 3600;
    console.log(`  ${c.recName} - Duration: ${hours.toFixed(2)}h - State: ${c.state || 'NULL'} - Qty: ${c.quantityDone}`);
  });
  
  // Check for any cycles with 'finished' in rec_name
  const finishedInName = await db.select({
    count: sql<number>`count(*)`
  }).from(workCycles)
  .where(
    sql`LOWER(${workCycles.work_cycles_rec_name}) LIKE '%finished%' OR LOWER(${workCycles.work_cycles_rec_name}) LIKE '%done%'`
  );
  
  console.log(`\nCycles with 'finished' or 'done' in rec_name: ${finishedInName[0].count}`);
  
  process.exit(0);
}

checkCompletedCycles().catch(console.error);
