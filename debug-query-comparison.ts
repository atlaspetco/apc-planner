// Debug script to compare ORM vs Raw SQL results
import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { eq, or, isNull, sql } from "drizzle-orm";

async function compareQueries() {
  console.log("=== QUERY COMPARISON DEBUG ===");
  
  // 1. Raw SQL query for Courtney Banh
  console.log("1. Raw SQL query for Courtney Banh:");
  const rawResult = await db.execute(
    sql`SELECT COUNT(*) as count 
        FROM work_cycles 
        WHERE work_cycles_operator_rec_name = 'Courtney Banh' 
        AND (data_corrupted = false OR data_corrupted IS NULL)`
  );
  console.log(`Raw SQL result: ${rawResult.rows[0]?.count || 0} cycles`);
  
  // 2. ORM query for all cycles (same filter as getCoreUphDetails)
  console.log("\n2. ORM query for all cycles:");
  const ormResult = await db.select().from(workCycles).where(
    or(
      eq(workCycles.data_corrupted, false),
      isNull(workCycles.data_corrupted)
    )
  );
  console.log(`ORM result: ${ormResult.length} total cycles`);
  
  // 3. Check Courtney Banh in ORM result
  const courtneyInOrm = ormResult.filter(c => c.work_cycles_operator_rec_name === 'Courtney Banh');
  console.log(`Courtney Banh in ORM result: ${courtneyInOrm.length} cycles`);
  
  // 4. Check unique operators in ORM result
  const uniqueOperators = [...new Set(ormResult.map(c => c.work_cycles_operator_rec_name))];
  console.log(`\n3. Unique operators in ORM result (first 10):`);
  console.log(uniqueOperators.slice(0, 10));
  
  // 5. Check if Courtney Banh exists at all
  console.log(`\n4. Does Courtney Banh exist in unique operators? ${uniqueOperators.includes('Courtney Banh')}`);
  
  // 6. Raw SQL for unique operators
  console.log("\n5. Raw SQL unique operators:");
  const rawOperators = await db.execute(
    sql`SELECT DISTINCT work_cycles_operator_rec_name 
        FROM work_cycles 
        WHERE (data_corrupted = false OR data_corrupted IS NULL)
        ORDER BY work_cycles_operator_rec_name
        LIMIT 10`
  );
  console.log("Raw SQL operators:", rawOperators.rows.map(r => r.work_cycles_operator_rec_name));
  
  process.exit(0);
}

compareQueries().catch(console.error);