import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function fixWO17620Corruption() {
  console.log("🚨 FIXING ADDITIONAL DATA CORRUPTION - WO17620");
  console.log("📸 Screenshot shows WO17620 belongs to MO21246 with Sally Rudolfs");
  console.log("📊 3 cycles: 2h + 1h + 4h = 7 hours total\n");

  // Check current state of WO17620
  const currentWO17620 = await db.execute(sql`
    SELECT work_id, work_production_number, work_production_id,
           work_cycles_operator_rec_name, work_cycles_work_center_rec_name,
           work_cycles_duration, work_cycles_quantity_done
    FROM work_cycles 
    WHERE work_id = 17620
  `);

  console.log("🗄️  CURRENT DATABASE:");
  if (currentWO17620.rows.length === 0) {
    console.log("   ❌ WO17620 NOT FOUND in database - this is the corruption!");
  } else {
    currentWO17620.rows.forEach(row => {
      console.log(`   WO${row.work_id}: ${row.work_production_number} - ${row.work_cycles_operator_rec_name} - ${row.work_cycles_duration}s`);
    });
  }

  // Get MO21246 production ID
  const mo21246Info = await db.execute(sql`
    SELECT DISTINCT work_production_id, work_production_number, COUNT(*) as cycles
    FROM work_cycles 
    WHERE work_production_number = 'MO21246'
    GROUP BY work_production_id, work_production_number
  `);

  console.log("\n🔍 CURRENT MO21246 DATA:");
  mo21246Info.rows.forEach(row => {
    console.log(`   ${row.work_production_number}: Production ID ${row.work_production_id}, ${row.cycles} cycles`);
  });

  if (mo21246Info.rows.length > 0) {
    const correctProductionId = mo21246Info.rows[0].work_production_id;
    
    // Check if WO17620 exists with wrong assignment or is missing entirely
    if (currentWO17620.rows.length === 0) {
      console.log("\n🔧 INSERTING MISSING WO17620 DATA:");
      
      // Insert the missing work order with 3 cycles as shown in screenshot
      const cycles = [
        { duration: 7200, quantity: 0 }, // 2 hours
        { duration: 3600, quantity: 0 }, // 1 hour  
        { duration: 14400, quantity: 75 } // 4 hours
      ];
      
      for (let i = 0; i < cycles.length; i++) {
        await db.execute(sql`
          INSERT INTO work_cycles (
            work_id,
            work_production_number,
            work_production_id,
            work_cycles_operator_rec_name,
            work_cycles_work_center_rec_name,
            work_cycles_duration,
            work_cycles_quantity_done,
            work_production_quantity,
            created_at,
            updated_at
          ) VALUES (
            17620,
            'MO21246',
            ${correctProductionId},
            'Sally Rudolfs',
            'Assembly',
            ${cycles[i].duration},
            ${cycles[i].quantity},
            75,
            NOW(),
            NOW()
          )
        `);
        console.log(`   ✅ Inserted cycle ${i+1}: ${cycles[i].duration}s`);
      }
    } else {
      console.log("\n🔧 CORRECTING EXISTING WO17620 DATA:");
      // Update existing record
      await db.execute(sql`
        UPDATE work_cycles 
        SET 
          work_production_number = 'MO21246',
          work_production_id = ${correctProductionId},
          work_cycles_operator_rec_name = 'Sally Rudolfs',
          work_cycles_work_center_rec_name = 'Assembly'
        WHERE work_id = 17620
      `);
      console.log("   ✅ Updated existing WO17620 data");
    }

    // Verify the fix
    const verifyFix = await db.execute(sql`
      SELECT work_id, work_production_number,
             work_cycles_operator_rec_name, work_cycles_duration
      FROM work_cycles 
      WHERE work_id = 17620
      ORDER BY created_at
    `);

    console.log("\n✅ AFTER FIX:");
    let totalTime = 0;
    verifyFix.rows.forEach((row, i) => {
      console.log(`   Cycle ${i+1}: ${row.work_cycles_duration}s (${row.work_cycles_duration/3600}h)`);
      totalTime += parseInt(row.work_cycles_duration);
    });
    console.log(`   Total: ${totalTime}s (${totalTime/3600}h)`);
    
    // Calculate corrected MO21246 totals
    const mo21246Total = await db.execute(sql`
      SELECT 
        COUNT(DISTINCT work_id) as work_orders,
        COUNT(*) as total_cycles,
        SUM(work_cycles_duration) as total_seconds,
        MAX(work_production_quantity) as mo_quantity
      FROM work_cycles 
      WHERE work_production_number = 'MO21246'
    `);
    
    const totalHours = parseFloat(mo21246Total.rows[0].total_seconds) / 3600;
    const uph = parseFloat(mo21246Total.rows[0].mo_quantity) / totalHours;
    
    console.log(`\n📊 CORRECTED MO21246 CALCULATION:`);
    console.log(`   Work Orders: ${mo21246Total.rows[0].work_orders}`);
    console.log(`   Total Cycles: ${mo21246Total.rows[0].total_cycles}`);
    console.log(`   Total Time: ${mo21246Total.rows[0].total_seconds}s (${totalHours.toFixed(4)}h)`);
    console.log(`   MO Quantity: ${mo21246Total.rows[0].mo_quantity}`);
    console.log(`   Corrected UPH: ${uph.toFixed(3)}`);
  }

  process.exit(0);
}

fixWO17620Corruption();