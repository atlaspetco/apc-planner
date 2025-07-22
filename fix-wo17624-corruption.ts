import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function fixDataCorruption() {
  console.log("🚨 FIXING CRITICAL DATA CORRUPTION - WO17624");
  
  // First, show current corrupted state
  const beforeFix = await db.execute(sql`
    SELECT work_id, work_production_number, work_production_id,
           work_cycles_operator_rec_name, work_cycles_work_center_rec_name,
           work_cycles_duration
    FROM work_cycles 
    WHERE work_id = 17624
  `);
  
  console.log("🗄️  BEFORE FIX (corrupted data):");
  beforeFix.rows.forEach(row => {
    console.log(`   WO${row.work_id}: ${row.work_production_number} - ${row.work_cycles_operator_rec_name} - ${row.work_cycles_duration}s`);
  });

  // Get the correct MO21262 production ID
  const mo21262Info = await db.execute(sql`
    SELECT DISTINCT work_production_id
    FROM work_cycles 
    WHERE work_production_number = 'MO21262'
    LIMIT 1
  `);
  
  const correctProductionId = mo21262Info.rows[0]?.work_production_id;
  console.log(`\n🔧 Correct Production ID for MO21262: ${correctProductionId}`);

  if (correctProductionId) {
    // Fix the corruption by updating WO17624 to belong to MO21262
    const updateResult = await db.execute(sql`
      UPDATE work_cycles 
      SET 
        work_production_number = 'MO21262',
        work_production_id = ${correctProductionId},
        work_cycles_operator_rec_name = 'Courtney Banh',
        work_cycles_work_center_rec_name = 'Assembly'
      WHERE work_id = 17624
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} record(s)`);
    
    // Verify the fix
    const afterFix = await db.execute(sql`
      SELECT work_id, work_production_number, work_production_id,
             work_cycles_operator_rec_name, work_cycles_work_center_rec_name,
             work_cycles_duration
      FROM work_cycles 
      WHERE work_id = 17624
    `);
    
    console.log("\n✅ AFTER FIX (corrected data):");
    afterFix.rows.forEach(row => {
      console.log(`   WO${row.work_id}: ${row.work_production_number} - ${row.work_cycles_operator_rec_name} - ${row.work_cycles_duration}s`);
    });
    
    // Now recalculate MO21262 totals
    const mo21262Total = await db.execute(sql`
      SELECT 
        COUNT(DISTINCT work_id) as work_orders,
        COUNT(*) as total_cycles,
        SUM(work_cycles_duration) as total_seconds,
        MAX(work_production_quantity) as mo_quantity
      FROM work_cycles 
      WHERE work_production_number = 'MO21262'
    `);
    
    const totalHours = parseFloat(mo21262Total.rows[0].total_seconds) / 3600;
    const uph = parseFloat(mo21262Total.rows[0].mo_quantity) / totalHours;
    
    console.log(`\n📊 CORRECTED MO21262 CALCULATION:`);
    console.log(`   Work Orders: ${mo21262Total.rows[0].work_orders}`);
    console.log(`   Total Cycles: ${mo21262Total.rows[0].total_cycles}`);
    console.log(`   Total Time: ${mo21262Total.rows[0].total_seconds}s (${totalHours.toFixed(4)}h)`);
    console.log(`   MO Quantity: ${mo21262Total.rows[0].mo_quantity}`);
    console.log(`   Corrected UPH: ${uph.toFixed(3)}`);
    
  } else {
    console.log("❌ Could not find correct Production ID for MO21262");
  }
  
  process.exit(0);
}

fixDataCorruption();