import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function investigateDataIntegrity() {
  console.log("🚨 INVESTIGATING CRITICAL DATA INTEGRITY ISSUE");
  console.log("🔍 User reports WO17624 should be part of MO21262, not MO21246\n");

  // 1. Check WO17624 current data
  const wo17624 = await db.execute(sql`
    SELECT 
      work_id,
      work_production_number,
      work_production_id,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_cycles_duration,
      work_operation_rec_name,
      created_at,
      updated_at
    FROM work_cycles 
    WHERE work_id = 17624
    LIMIT 5
  `);

  console.log("📊 WO17624 Current Data:");
  wo17624.rows.forEach((row, i) => {
    console.log(`${i+1}. MO: ${row.work_production_number}, Production ID: ${row.work_production_id}`);
    console.log(`   Operator: ${row.work_cycles_operator_rec_name}, Duration: ${row.work_cycles_duration}s`);
    console.log(`   Work Center: ${row.work_cycles_work_center_rec_name}`);
    console.log(`   Created: ${row.created_at}, Updated: ${row.updated_at}\n`);
  });

  // 2. Check all work cycles for MO21262
  const mo21262Cycles = await db.execute(sql`
    SELECT DISTINCT
      work_id,
      work_production_number,
      work_production_id,
      COUNT(*) as cycle_count
    FROM work_cycles 
    WHERE work_production_number = 'MO21262'
    GROUP BY work_id, work_production_number, work_production_id
    ORDER BY work_id
  `);

  console.log("📊 ALL Work Orders for MO21262:");
  mo21262Cycles.rows.forEach(row => {
    console.log(`WO${row.work_id}: ${row.cycle_count} cycles, Production ID: ${row.work_production_id}`);
  });

  // 3. Check if there are multiple production records with similar numbers
  const similarMOs = await db.execute(sql`
    SELECT DISTINCT work_production_number, work_production_id, COUNT(*) as cycle_count
    FROM work_cycles 
    WHERE work_production_number LIKE '%21262%' OR work_production_number LIKE '%21246%'
    GROUP BY work_production_number, work_production_id
    ORDER BY work_production_number
  `);

  console.log("\n📊 Similar MO Numbers (21262/21246):");
  similarMOs.rows.forEach(row => {
    console.log(`${row.work_production_number} (ID: ${row.work_production_id}): ${row.cycle_count} cycles`);
  });

  // 4. Check if WO17624 has been updated/reassigned
  const wo17624History = await db.execute(sql`
    SELECT 
      work_id,
      work_production_number,
      work_production_id,
      work_cycles_id,
      created_at,
      updated_at,
      work_cycles_operator_rec_name
    FROM work_cycles 
    WHERE work_id = 17624
    ORDER BY created_at, work_cycles_id
  `);

  console.log("\n🕐 WO17624 Full History (by creation date):");
  wo17624History.rows.forEach((row, i) => {
    console.log(`${i+1}. Cycle ${row.work_cycles_id}: ${row.work_production_number} (ID: ${row.work_production_id})`);
    console.log(`   Created: ${row.created_at}, Updated: ${row.updated_at}`);
    console.log(`   Operator: ${row.work_cycles_operator_rec_name}`);
  });

  // 5. Check production orders table for these MOs
  const productionOrders = await db.execute(sql`
    SELECT id, rec_name, state, quantity, planned_date
    FROM production_orders 
    WHERE rec_name LIKE '%21262%' OR rec_name LIKE '%21246%'
    ORDER BY rec_name
  `);

  console.log("\n📊 Production Orders Table:");
  productionOrders.rows.forEach(row => {
    console.log(`${row.rec_name}: State=${row.state}, Qty=${row.quantity}, Planned=${row.planned_date}`);
  });

  process.exit(0);
}

investigateDataIntegrity();