import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function analyzeWorkCycles() {
  console.log('🔍 Analyzing work_cycles table...\n');
  
  // Get table statistics
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_records,
      COUNT(DISTINCT work_production_number) as unique_mos,
      COUNT(DISTINCT work_cycles_operator_rec_name) as unique_operators,
      COUNT(DISTINCT work_cycles_work_center_rec_name) as unique_work_centers,
      MIN(work_production_number) as min_mo,
      MAX(work_production_number) as max_mo,
      COUNT(CASE WHEN work_production_quantity > 0 THEN 1 END) as records_with_quantity,
      COUNT(CASE WHEN work_cycles_duration > 0 THEN 1 END) as records_with_duration
    FROM work_cycles
  `);
  
  console.log('📊 Table Statistics:');
  console.log(stats.rows[0]);
  
  // Sample recent work cycles
  console.log('\n📝 Sample Recent Work Cycles:');
  const samples = await db.execute(sql`
    SELECT 
      work_cycles_id,
      work_production_number,
      work_production_quantity,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_routing_rec_name,
      work_cycles_duration,
      state
    FROM work_cycles
    WHERE work_production_number IS NOT NULL
    ORDER BY work_cycles_id DESC
    LIMIT 10
  `);
  
  samples.rows.forEach(row => {
    console.log(`ID: ${row.work_cycles_id}, MO: ${row.work_production_number}, Qty: ${row.work_production_quantity}, Operator: ${row.work_cycles_operator_rec_name}, Duration: ${row.work_cycles_duration}s`);
  });
  
  // Check MO number ranges
  console.log('\n📈 MO Number Analysis:');
  const moRanges = await db.execute(sql`
    SELECT 
      SUBSTRING(work_production_number FROM 3 FOR 2) as mo_prefix,
      COUNT(*) as count,
      MIN(work_production_number) as min_mo,
      MAX(work_production_number) as max_mo
    FROM work_cycles
    WHERE work_production_number IS NOT NULL
    GROUP BY SUBSTRING(work_production_number FROM 3 FOR 2)
    ORDER BY count DESC
    LIMIT 10
  `);
  
  console.log('MO number prefixes (MOxx...)');
  moRanges.rows.forEach(row => {
    console.log(`- MO${row.mo_prefix}xxx: ${row.count} records (${row.min_mo} to ${row.max_mo})`);
  });
  
  process.exit(0);
}

analyzeWorkCycles().catch(console.error);