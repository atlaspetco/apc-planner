import { sql } from "drizzle-orm";
import { db } from './server/db.js';

async function debugAllUphCalculations() {
  console.log("🔍 Debugging ALL UPH calculation methods for Courtney Banh + Assembly + Lifetime Pouch");

  // Method 1: My debug script approach (first 10 MOs only)
  console.log("\n=== METHOD 1: First 10 MOs Debug Script ===");
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

  let totalUphSum = 0;
  let moCount = 0;
  
  moAggregation.rows.forEach((mo) => {
    const durationHours = parseFloat(mo.total_duration_seconds) / 3600;
    const moQuantity = parseFloat(mo.mo_quantity);
    const uph = moQuantity / durationHours;
    totalUphSum += uph;
    moCount++;
  });
  console.log(`Method 1 Result: ${(totalUphSum / moCount).toFixed(2)} UPH from ${moCount} MOs`);

  // Method 2: All MOs (like the accurate calculation)
  console.log("\n=== METHOD 2: ALL MOs (Like accurate calculation) ===");
  const allMosAggregation = await db.execute(sql`
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

  let allTotalUphSum = 0;
  let allMoCount = 0;
  
  allMosAggregation.rows.forEach((mo) => {
    const durationHours = parseFloat(mo.total_duration_seconds) / 3600;
    const moQuantity = parseFloat(mo.mo_quantity);
    const uph = moQuantity / durationHours;
    allTotalUphSum += uph;
    allMoCount++;
  });
  console.log(`Method 2 Result: ${(allTotalUphSum / allMoCount).toFixed(2)} UPH from ${allMoCount} MOs`);

  // Method 3: Check what getAccurateMoDetails would return
  console.log("\n=== METHOD 3: GetAccurateMoDetails function approach ===");
  const cyclesResult = await db.execute(sql`
    SELECT DISTINCT
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center_name,
      work_production_routing_rec_name as routing_name,
      work_production_number as mo_number,
      work_production_quantity as mo_quantity,
      work_cycles_duration as duration_seconds,
      work_operation_rec_name as operation_name,
      updated_at as mo_date,
      work_cycles_id as cycle_id
    FROM work_cycles 
    WHERE (state = 'done' OR state IS NULL)
      AND work_cycles_operator_rec_name = 'Courtney Banh'
      AND work_production_routing_rec_name = 'Lifetime Pouch'
      AND work_cycles_duration > 0
      AND work_production_quantity > 0
    ORDER BY work_production_number, work_cycles_id
  `);

  const cycles = cyclesResult.rows;
  console.log(`Found ${cycles.length} work cycles total`);

  // Filter by work center (like the function does)
  const filteredCycles = cycles.filter(cycle => {
    const workCenter = cycle.work_center_name?.toString() || '';
    const transformed = workCenter.toLowerCase().includes('sewing') || workCenter.toLowerCase().includes('assembly') ? 'Assembly' : workCenter;
    return transformed === 'Assembly';
  });
  
  console.log(`Filtered to ${filteredCycles.length} cycles after work center filtering`);

  // Group by MO
  const moGroups = new Map();
  for (const cycle of filteredCycles) {
    const moNumber = cycle.mo_number?.toString() || '';
    const moQuantity = parseFloat(cycle.mo_quantity?.toString() || '0');
    const durationSeconds = parseFloat(cycle.duration_seconds?.toString() || '0');
    
    if (!moGroups.has(moNumber)) {
      moGroups.set(moNumber, {
        moNumber,
        moQuantity,
        totalDurationSeconds: 0,
        cycleCount: 0
      });
    }
    
    const group = moGroups.get(moNumber);
    group.totalDurationSeconds += durationSeconds;
    group.cycleCount++;
  }

  let method3TotalUph = 0;
  let method3Count = 0;
  
  for (const [moNumber, group] of moGroups) {
    if (group.totalDurationSeconds > 0 && group.moQuantity > 0) {
      const durationHours = group.totalDurationSeconds / 3600;
      const uph = group.moQuantity / durationHours;
      method3TotalUph += uph;
      method3Count++;
    }
  }

  const method3Average = method3Count > 0 ? method3TotalUph / method3Count : 0;
  console.log(`Method 3 Result: ${method3Average.toFixed(2)} UPH from ${method3Count} MOs`);

  // Method 4: Check current database value
  console.log("\n=== METHOD 4: Current Database Value ===");
  const dbResult = await db.execute(sql`
    SELECT 
      units_per_hour as uph,
      observations,
      total_hours,
      total_quantity
    FROM historical_uph 
    WHERE operator = 'Courtney Banh'
      AND routing = 'Lifetime Pouch'
      AND work_center = 'Assembly'
  `);
  
  if (dbResult.rows.length > 0) {
    const record = dbResult.rows[0];
    console.log(`Database shows: UPH=${record.uph}, Observations=${record.observations}`);
    console.log(`Total Hours: ${record.total_hours}, Total Quantity: ${record.total_quantity}`);
    
    if (record.total_hours && record.total_quantity) {
      const calculatedFromTotals = record.total_quantity / record.total_hours;
      console.log(`Calculated from totals: ${calculatedFromTotals.toFixed(2)} UPH`);
    }
  } else {
    console.log("No database record found");
  }

  process.exit(0);
}

debugAllUphCalculations();