import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function checkOutlierFiltering() {
  console.log("🔍 Finding MOs that should be filtered as outliers for Courtney Banh + Assembly + Lifetime Pouch");

  // Get all MOs for this combination and their UPH values
  const allMos = await db.execute(sql`
    SELECT 
      work_production_number as mo_number,
      work_production_quantity as mo_quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = 'Courtney Banh'
      AND work_production_routing_rec_name = 'Lifetime Pouch'
      AND (work_cycles_work_center_rec_name ILIKE '%sewing%' 
           OR work_cycles_work_center_rec_name ILIKE '%assembly%')
      AND work_cycles_duration > 0
      AND work_production_quantity > 0
    GROUP BY work_production_number, work_production_quantity
    ORDER BY work_production_number
  `);

  console.log(`\n📊 All ${allMos.rows.length} MOs with UPH analysis:`);
  let outlierCount = 0;
  let validCount = 0;
  let validUphSum = 0;
  
  allMos.rows.forEach((mo, index) => {
    const durationHours = parseFloat(mo.total_duration_seconds) / 3600;
    const moQuantity = parseFloat(mo.mo_quantity);
    const uph = moQuantity / durationHours;
    
    // Apply outlier filtering logic
    const isRealistic = uph <= 100 && durationHours >= (5/60);
    
    if (isRealistic) {
      validCount++;
      validUphSum += uph;
      if (index < 20) { // Show first 20 valid ones
        console.log(`✅ ${index + 1}. MO: ${mo.mo_number} - UPH: ${uph.toFixed(2)} (${moQuantity} units in ${durationHours.toFixed(2)}h)`);
      }
    } else {
      outlierCount++;
      if (outlierCount <= 10) { // Show first 10 outliers
        console.log(`❌ OUTLIER ${outlierCount}. MO: ${mo.mo_number} - UPH: ${uph.toFixed(2)} (${moQuantity} units in ${durationHours.toFixed(2)}h) - ${uph > 100 ? 'UPH too high' : 'Duration too short'}`);
      }
    }
  });

  const averageValidUph = validCount > 0 ? validUphSum / validCount : 0;
  
  console.log(`\n🎯 SUMMARY:`);
  console.log(`   Total MOs: ${allMos.rows.length}`);
  console.log(`   Valid MOs: ${validCount}`);
  console.log(`   Outliers filtered: ${outlierCount}`);
  console.log(`   Average UPH after filtering: ${averageValidUph.toFixed(2)}`);
  
  process.exit(0);
}

checkOutlierFiltering();