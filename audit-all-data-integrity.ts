import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function auditDataIntegrity() {
  console.log("🔍 COMPREHENSIVE DATA INTEGRITY AUDIT");
  console.log("🎯 Checking for systematic data corruption patterns\n");

  // Check for missing work orders in sequence 17620-17630
  console.log("📊 WORK ORDER SEQUENCE 17620-17630:");
  for (let woId = 17620; woId <= 17630; woId++) {
    const woExists = await db.execute(sql`
      SELECT COUNT(*) as count FROM work_cycles WHERE work_id = ${woId}
    `);
    
    const status = woExists.rows[0].count > 0 ? '✅' : '❌';
    console.log(`${status} WO${woId}: ${woExists.rows[0].count} cycles`);
  }

  // Check for any other MOs that might have corruption
  console.log("\n📊 PRODUCTION ORDERS SUMMARY:");
  const moSummary = await db.execute(sql`
    SELECT 
      work_production_number,
      work_production_id,
      COUNT(DISTINCT work_id) as work_orders,
      COUNT(*) as total_cycles,
      SUM(work_cycles_duration) as total_seconds,
      STRING_AGG(DISTINCT CAST(work_id AS TEXT), ', ' ORDER BY work_id) as wo_list
    FROM work_cycles 
    WHERE work_production_number LIKE 'MO212%'
    GROUP BY work_production_number, work_production_id
    ORDER BY work_production_number
  `);

  moSummary.rows.forEach(row => {
    const hours = parseFloat(row.total_seconds) / 3600;
    console.log(`${row.work_production_number} (ID: ${row.work_production_id}):`);
    console.log(`   Work Orders: ${row.wo_list}`);
    console.log(`   Total Time: ${hours.toFixed(2)}h, Cycles: ${row.total_cycles}`);
  });

  // Look for operator mismatches that might indicate more corruption
  console.log("\n🔍 OPERATOR ASSIGNMENTS BY WORK ORDER:");
  const operatorCheck = await db.execute(sql`
    SELECT 
      work_id,
      work_production_number,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      COUNT(*) as cycles
    FROM work_cycles 
    WHERE work_id BETWEEN 17620 AND 17630
    GROUP BY work_id, work_production_number, work_cycles_operator_rec_name, work_cycles_work_center_rec_name
    ORDER BY work_id
  `);

  operatorCheck.rows.forEach(row => {
    console.log(`WO${row.work_id}: ${row.work_production_number} - ${row.work_cycles_operator_rec_name} - ${row.work_cycles_work_center_rec_name} (${row.cycles} cycles)`);
  });

  process.exit(0);
}

auditDataIntegrity();