import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function checkCompletedWorkCycles() {
  console.log("Checking for completed work cycles...\n");

  // Check for work cycles with 'done' or 'finished' state
  const completedCycles = await db
    .select({
      id: workCycles.id,
      workOrderId: sql<number>`CAST(NULLIF(REGEXP_REPLACE(${workCycles.work_cycles_rec_name}, 'WO([0-9]+).*', '\\1'), '') AS INTEGER)`,
      operatorName: workCycles.work_cycles_operator_rec_name,
      duration: workCycles.work_cycles_duration,
      state: workCycles.work_cycles_state,
      rec_name: workCycles.work_cycles_rec_name,
      moNumber: sql<string>`REGEXP_REPLACE(${workCycles.work_cycles_rec_name}, '.*MO([0-9]+).*', 'MO\\1')`
    })
    .from(workCycles)
    .where(sql`${workCycles.work_cycles_duration} > 0 
      AND ${workCycles.work_cycles_duration} IS NOT NULL
      AND (LOWER(${workCycles.work_cycles_rec_name}) LIKE '%done%' 
        OR LOWER(${workCycles.work_cycles_rec_name}) LIKE '%finished%'
        OR ${workCycles.work_cycles_state} = 'done'
        OR ${workCycles.work_cycles_state} = 'finished')`)
    .limit(10);

  console.log(`Found ${completedCycles.length} completed work cycles (showing first 10):`);
  completedCycles.forEach(cycle => {
    const hours = cycle.duration ? (cycle.duration / 3600).toFixed(2) : '0';
    console.log(`- WO${cycle.workOrderId} (${cycle.moNumber}): ${cycle.operatorName} - ${hours}h - State: ${cycle.state} - Rec: ${cycle.rec_name}`);
  });

  // Check total count
  const totalCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(workCycles)
    .where(sql`${workCycles.work_cycles_duration} > 0 
      AND ${workCycles.work_cycles_duration} IS NOT NULL
      AND (LOWER(${workCycles.work_cycles_rec_name}) LIKE '%done%' 
        OR LOWER(${workCycles.work_cycles_rec_name}) LIKE '%finished%'
        OR ${workCycles.work_cycles_state} = 'done'
        OR ${workCycles.work_cycles_state} = 'finished')`);

  console.log(`\nTotal completed work cycles: ${totalCount[0].count}`);

  // Check for work cycles with state field
  const cyclesWithState = await db
    .select({ 
      count: sql<number>`count(*)`,
      state: workCycles.work_cycles_state 
    })
    .from(workCycles)
    .where(sql`${workCycles.work_cycles_state} IS NOT NULL`)
    .groupBy(workCycles.work_cycles_state)
    .limit(10);

  console.log("\nWork cycles grouped by state:");
  cyclesWithState.forEach(row => {
    console.log(`- ${row.state}: ${row.count} cycles`);
  });

  process.exit(0);
}

checkCompletedWorkCycles().catch(console.error);