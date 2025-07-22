import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function debugLifetimePouchUph() {
  console.log("🔍 Debugging Lifetime Pouch UPH calculation for Courtney Banh");

  // Get raw work cycles data for Courtney + Assembly + Lifetime Pouch
  const cyclesResult = await db.execute(sql`
    SELECT 
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center_name,
      work_production_routing_rec_name as routing_name,
      work_production_number as mo_number,
      work_production_quantity as mo_quantity,
      work_cycles_duration as duration_seconds,
      work_operation_rec_name as operation_name
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = 'Courtney Banh'
      AND work_production_routing_rec_name = 'Lifetime Pouch'
      AND (work_cycles_work_center_rec_name ILIKE '%sewing%' 
           OR work_cycles_work_center_rec_name ILIKE '%assembly%')
      AND work_cycles_duration > 0
      AND work_production_quantity > 0
    ORDER BY work_production_number
    LIMIT 10
  `);

  console.log('\n📊 Raw work cycles (first 10):');
  cyclesResult.rows.forEach((cycle, index) => {
    console.log(`${index + 1}. MO: ${cycle.mo_number}, Quantity: ${cycle.mo_quantity}, Duration: ${cycle.duration_seconds}s, Operation: ${cycle.operation_name}`);
  });

  // Get MO-level aggregation
  const moAggregation = await db.execute(sql`
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
    LIMIT 10
  `);

  console.log('\n🎯 MO-level aggregation (first 10):');
  let totalUphSum = 0;
  let moCount = 0;
  
  moAggregation.rows.forEach((mo, index) => {
    const durationHours = parseFloat(mo.total_duration_seconds) / 3600;
    const moQuantity = parseFloat(mo.mo_quantity);
    const uph = moQuantity / durationHours;
    
    console.log(`${index + 1}. MO: ${mo.mo_number}`);
    console.log(`   Quantity: ${moQuantity} units`);
    console.log(`   Duration: ${durationHours.toFixed(2)} hours (${mo.cycle_count} cycles)`);
    console.log(`   UPH: ${uph.toFixed(2)}`);
    
    totalUphSum += uph;
    moCount++;
  });

  const averageUph = totalUphSum / moCount;
  console.log(`\n🏁 Average UPH across ${moCount} MOs: ${averageUph.toFixed(2)}`);

  // Check what the database shows
  const dbUphResult = await db.execute(sql`
    SELECT 
      operator,
      routing,
      work_center as workCenter,
      units_per_hour as unitsPerHour,
      observations
    FROM historical_uph 
    WHERE operator = 'Courtney Banh'
      AND routing = 'Lifetime Pouch'
      AND work_center = 'Assembly'
  `);

  console.log('\n💾 Database UPH record:');
  if (dbUphResult.rows.length > 0) {
    const dbRecord = dbUphResult.rows[0];
    console.log(`   UPH: ${dbRecord.unitsPerHour}`);
    console.log(`   Observations: ${dbRecord.observations}`);
  } else {
    console.log('   No database record found');
  }

  process.exit(0);
}

debugLifetimePouchUph();