import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function checkFulfilData() {
  console.log("🔍 CHECKING FULFIL DATA INTEGRITY FOR MO21262 vs WO17624");
  
  // Check raw work_cycles data for the specific time period
  const rawData = await db.execute(sql`
    SELECT 
      work_id,
      work_production_number,
      work_production_id,
      work_cycles_operator_rec_name,
      work_cycles_duration,
      work_cycles_quantity_done,
      work_production_quantity,
      created_at
    FROM work_cycles 
    WHERE work_id IN (17624, 17625, 17626, 17627, 17628)
    ORDER BY work_id, created_at
  `);

  console.log("📊 Raw Data for Work Orders 17624-17628:");
  rawData.rows.forEach(row => {
    console.log(`WO${row.work_id}: ${row.work_production_number} (Prod ID: ${row.work_production_id})`);
    console.log(`   Operator: ${row.work_cycles_operator_rec_name}`);
    console.log(`   Duration: ${row.work_cycles_duration}s, Cycle Qty: ${row.work_cycles_quantity_done}, MO Qty: ${row.work_production_quantity}`);
    console.log(`   Created: ${row.created_at}\n`);
  });

  // Check if there are any work orders missing from the sequence
  const sequenceGaps = await db.execute(sql`
    SELECT work_id
    FROM work_cycles 
    WHERE work_id BETWEEN 17620 AND 17630
    ORDER BY work_id
  `);

  console.log("📊 Work Order Sequence 17620-17630:");
  const foundWOs = sequenceGaps.rows.map(r => r.work_id);
  for (let i = 17620; i <= 17630; i++) {
    const status = foundWOs.includes(i) ? '✅' : '❌';
    console.log(`${status} WO${i}`);
  }

  // Check for duplicate MO assignments
  const duplicateCheck = await db.execute(sql`
    SELECT 
      work_production_number,
      work_production_id,
      COUNT(DISTINCT work_id) as work_orders,
      COUNT(*) as total_cycles,
      STRING_AGG(DISTINCT CAST(work_id AS TEXT), ', ' ORDER BY work_id) as wo_list
    FROM work_cycles 
    WHERE work_production_number IN ('MO21262', 'MO21246')
    GROUP BY work_production_number, work_production_id
    ORDER BY work_production_number
  `);

  console.log("\n📊 Production Order Summary:");
  duplicateCheck.rows.forEach(row => {
    console.log(`${row.work_production_number} (ID: ${row.work_production_id}):`);
    console.log(`   Work Orders: ${row.wo_list}`);
    console.log(`   Total Cycles: ${row.total_cycles}`);
  });

  process.exit(0);
}

checkFulfilData();