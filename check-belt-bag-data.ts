import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

async function checkBeltBagData() {
  // Check Belt Bag MO data
  const beltBagCycles = await db.select()
    .from(workCycles)
    .where(and(
      eq(workCycles.work_production_number, 'MO186642'),
      eq(workCycles.work_production_routing_rec_name, 'Belt Bag')
    ))
    .limit(10);

  console.log('Belt Bag MO186642 cycles:');
  beltBagCycles.forEach(cycle => {
    console.log({
      work_id: cycle.work_id,
      work_rec_name: cycle.work_rec_name,
      quantity_done: cycle.work_cycles_quantity_done,
      duration_seconds: cycle.work_cycles_duration,
      operator: cycle.work_cycles_operator_rec_name,
      work_center: cycle.work_cycles_work_center_rec_name
    });
  });

  // Check if we have production order data with correct quantities
  const distinctMOs = await db.execute(sql`
    SELECT DISTINCT 
      work_production_number as mo_number,
      work_production_routing_rec_name as routing,
      COUNT(DISTINCT work_id) as work_order_count,
      COUNT(*) as cycle_count,
      SUM(work_cycles_quantity_done) as total_quantity_sum,
      MAX(work_cycles_quantity_done) as max_quantity
    FROM work_cycles 
    WHERE work_production_routing_rec_name = 'Belt Bag'
    GROUP BY work_production_number, work_production_routing_rec_name
    ORDER BY work_production_number
    LIMIT 10
  `);

  console.log('\nBelt Bag MO summary:');
  console.log(distinctMOs.rows);

  // Check if we have the actual MO quantity in production_orders table
  const moData = await db.select()
    .from(productionOrders)
    .where(eq(productionOrders.moNumber, 'MO186642'))
    .limit(1);

  console.log('\nProduction order data for MO186642:');
  console.log(moData);
}

checkBeltBagData().catch(console.error);