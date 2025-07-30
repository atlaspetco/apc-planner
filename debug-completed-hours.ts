import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { gt, isNotNull, eq, and, like } from "drizzle-orm";

async function debugCompletedHours() {
  console.log("=== DEBUGGING COMPLETED HOURS ===");
  
  // Check total work cycles
  const allCycles = await db.select().from(workCycles).limit(10);
  console.log(`\nTotal work cycles in first 10 records:`);
  allCycles.forEach((cycle, i) => {
    console.log(`${i+1}. Duration: ${cycle.work_cycles_duration}, State: ${cycle.state}, Operator: ${cycle.work_cycles_operator_rec_name}, PO ID: ${cycle.work_production_id}`);
  });
  
  // Check completed cycles (state = 'done')
  const completedCycles = await db
    .select()
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        eq(workCycles.state, 'done')
      )
    )
    .limit(10);
  
  console.log(`\nCompleted cycles (state = 'done'): ${completedCycles.length}`);
  completedCycles.forEach((cycle, i) => {
    console.log(`${i+1}. Duration: ${cycle.work_cycles_duration}s, Operator: ${cycle.work_cycles_operator_rec_name}, PO ID: ${cycle.work_production_id}`);
  });
  
  // Check if we have ANY cycles with state = 'done'
  const anyDone = await db
    .select()
    .from(workCycles)
    .where(eq(workCycles.state, 'done'))
    .limit(5);
  
  console.log(`\nAny cycles with state = 'done': ${anyDone.length}`);
  
  // Check what states we actually have
  const stateCheck = await db
    .select({
      state: workCycles.state,
      count: workCycles.id
    })
    .from(workCycles)
    .limit(100);
  
  const stateCounts = new Map();
  stateCheck.forEach(row => {
    const state = row.state || 'null';
    stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
  });
  
  console.log(`\nState distribution (first 100 records):`);
  stateCounts.forEach((count, state) => {
    console.log(`  ${state}: ${count}`);
  });
  
  // Check Courtney Banh specifically
  const courtneyCheck = await db
    .select()
    .from(workCycles)
    .where(
      and(
        like(workCycles.work_cycles_operator_rec_name, '%Courtney%'),
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration)
      )
    )
    .limit(10);
  
  console.log(`\nCourtney Banh cycles with valid duration: ${courtneyCheck.length}`);
  courtneyCheck.forEach((cycle, i) => {
    console.log(`${i+1}. Duration: ${cycle.work_cycles_duration}s, State: ${cycle.state}, PO ID: ${cycle.work_production_id}`);
  });
  
  // Check if we should use NULL state instead of 'done'
  const nullStateCompleted = await db
    .select()
    .from(workCycles)
    .where(
      and(
        gt(workCycles.work_cycles_duration, 0),
        isNotNull(workCycles.work_cycles_duration),
        // Check both null state and actual values
      )
    )
    .limit(20);
  
  console.log(`\nAll cycles with valid duration (any state): ${nullStateCompleted.length}`);
  nullStateCompleted.slice(0, 5).forEach((cycle, i) => {
    console.log(`${i+1}. Duration: ${cycle.work_cycles_duration}s, State: '${cycle.state}', Operator: ${cycle.work_cycles_operator_rec_name}, PO: ${cycle.work_production_id}`);
  });
  
  process.exit(0);
}

debugCompletedHours().catch(console.error);