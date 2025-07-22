import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function debugMO21262() {
  console.log("🚨 CRITICAL DATA CORRUPTION DETECTED");
  console.log("📸 Screenshot shows WO17624 belongs to MO21262 with Courtney Banh");
  console.log("🗄️  Our database incorrectly shows WO17624 as MO21246\n");

  // 1. Check current incorrect data
  const currentWO17624 = await db.execute(sql`
    SELECT work_id, work_production_number, work_production_id, 
           work_cycles_operator_rec_name, work_cycles_work_center_rec_name,
           work_cycles_duration, work_cycles_quantity_done, work_production_quantity
    FROM work_cycles 
    WHERE work_id = 17624
  `);

  console.log("🗄️  CURRENT DATABASE (INCORRECT):");
  currentWO17624.rows.forEach(row => {
    console.log(`   WO${row.work_id}: ${row.work_production_number} (Production ID: ${row.work_production_id})`);
    console.log(`   Operator: ${row.work_cycles_operator_rec_name}`);
    console.log(`   Work Center: ${row.work_cycles_work_center_rec_name}`);
    console.log(`   Duration: ${row.work_cycles_duration}s, Quantity: ${row.work_cycles_quantity_done}/${row.work_production_quantity}`);
  });

  console.log("\n📸 FULFIL SCREENSHOT (CORRECT):");
  console.log("   WO17624: MO21262 with Courtney Banh");
  console.log("   6 work cycles: 47s, 2h, 2h, 31min, 11min, 46min");
  console.log("   Work Center: Sewing/Assembly");
  console.log("   Status: Done");

  // 2. Calculate what the correct total time should be
  const screenshotCycles = [47, 7200, 7200, 1860, 660, 2760]; // seconds from screenshot
  const totalSeconds = screenshotCycles.reduce((sum, duration) => sum + duration, 0);
  const totalHours = totalSeconds / 3600;
  
  console.log(`\n📊 CORRECT CALCULATION (from screenshot):`);
  console.log(`   Total Duration: ${totalSeconds}s (${totalHours.toFixed(4)}h)`);
  console.log(`   Expected UPH: ${(75 / totalHours).toFixed(3)} for 75 units`);

  // 3. Check if we can find the correct MO21262 production ID
  const correctMO = await db.execute(sql`
    SELECT DISTINCT work_production_number, work_production_id, COUNT(*) as cycles
    FROM work_cycles 
    WHERE work_production_number = 'MO21262'
    GROUP BY work_production_number, work_production_id
  `);

  console.log(`\n🔍 CURRENT MO21262 DATA:`);
  correctMO.rows.forEach(row => {
    console.log(`   ${row.work_production_number}: Production ID ${row.work_production_id}, ${row.cycles} cycles`);
  });

  // 4. Look for any Courtney Banh + Sewing data that might be mislabeled
  const courtneyAssembly = await db.execute(sql`
    SELECT work_id, work_production_number, work_production_id,
           work_cycles_duration, work_cycles_quantity_done, created_at
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name LIKE '%Courtney%'
      AND (work_cycles_work_center_rec_name LIKE '%Sewing%' 
           OR work_cycles_work_center_rec_name LIKE '%Assembly%')
      AND work_id BETWEEN 17620 AND 17630
    ORDER BY work_id, created_at
  `);

  console.log(`\n🔍 COURTNEY'S SEWING/ASSEMBLY WORK (17620-17630):`);
  courtneyAssembly.rows.forEach(row => {
    console.log(`   WO${row.work_id}: ${row.work_production_number} - ${row.work_cycles_duration}s, Qty: ${row.work_cycles_quantity_done}`);
  });

  process.exit(0);
}

debugMO21262();