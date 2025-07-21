import { db } from './server/db.js';
import { workCycles } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';

async function analyzeBeltBagQuantities() {
  // Check MO129473 cycles in detail
  const cycles = await db.execute(sql`
    SELECT 
      work_id,
      work_rec_name,
      work_cycles_operator_rec_name as operator,
      work_cycles_work_center_rec_name as work_center,
      work_cycles_quantity_done as quantity,
      work_cycles_duration as duration_seconds,
      CAST(work_cycles_duration / 3600.0 AS DECIMAL(10,2)) as duration_hours
    FROM work_cycles 
    WHERE work_production_number = 'MO129473'
    AND work_production_routing_rec_name = 'Belt Bag'
    ORDER BY work_id, work_cycles_operator_rec_name
  `);

  console.log('MO129473 Belt Bag work cycles:');
  cycles.rows.forEach(row => console.log(row));

  // Show the problem: same quantity appearing multiple times
  const summary = await db.execute(sql`
    SELECT 
      work_production_number as mo_number,
      COUNT(DISTINCT work_id) as unique_work_orders,
      COUNT(*) as total_cycles,
      SUM(work_cycles_quantity_done) as sum_of_quantities,
      MAX(work_cycles_quantity_done) as max_quantity,
      MIN(work_cycles_quantity_done) as min_quantity,
      CAST(SUM(work_cycles_duration) / 3600.0 AS DECIMAL(10,2)) as total_hours
    FROM work_cycles 
    WHERE work_production_number = 'MO129473'
    GROUP BY work_production_number
  `);

  console.log('\nMO129473 Summary:');
  console.log(summary.rows[0]);
  
  const data = summary.rows[0] as any;
  const currentUph = data.sum_of_quantities / data.total_hours;
  const correctUph = data.max_quantity / data.total_hours;
  
  console.log('\nCurrent UPH calculation (summing quantities):', currentUph.toFixed(2), 'UPH');
  console.log('Correct UPH calculation (using MO quantity once):', correctUph.toFixed(2), 'UPH');
  console.log('\nThe issue: We are summing quantity', data.total_cycles, 'times instead of using it once!');

  // Let's see how this affects different work centers
  const workCenterBreakdown = await db.execute(sql`
    SELECT 
      work_cycles_work_center_rec_name as work_center,
      COUNT(*) as cycle_count,
      SUM(work_cycles_quantity_done) as sum_quantities,
      MAX(work_cycles_quantity_done) as max_quantity,
      CAST(SUM(work_cycles_duration) / 3600.0 AS DECIMAL(10,2)) as total_hours
    FROM work_cycles 
    WHERE work_production_number = 'MO129473'
    GROUP BY work_cycles_work_center_rec_name
  `);

  console.log('\nWork center breakdown for MO129473:');
  workCenterBreakdown.rows.forEach(row => console.log(row));
}

analyzeBeltBagQuantities().catch(console.error);