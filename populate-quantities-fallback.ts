import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { sql, inArray } from 'drizzle-orm';

async function populateQuantitiesFallback() {
  console.log('🔧 Updating quantities for matching MOs...');
  
  // Get the matching MOs
  const matchingMOs = [
    'MO173891', 'MO173892', 'MO173893', 'MO173896',
    'MO173897', 'MO173898', 'MO174231', 'MO174232'
  ];
  
  // Get production order quantities for these MOs
  const orders = await db
    .select()
    .from(productionOrders)
    .where(inArray(productionOrders.moNumber, matchingMOs));
  
  const moQuantityMap = new Map<string, number>();
  orders.forEach(order => {
    moQuantityMap.set(order.moNumber, order.quantity);
  });
  
  console.log(`Found ${orders.length} production orders with quantities`);
  
  // Update work cycles with these quantities
  let updateCount = 0;
  for (const [moNumber, quantity] of moQuantityMap) {
    const result = await db.execute(sql`
      UPDATE work_cycles 
      SET work_production_quantity = ${quantity}
      WHERE work_production_number = ${moNumber}
        AND (work_production_quantity IS NULL OR work_production_quantity = 0)
    `);
    
    updateCount += result.rowCount || 0;
    console.log(`Updated MO ${moNumber} with quantity ${quantity}`);
  }
  
  console.log(`\n✅ Updated ${updateCount} work cycle records`);
  
  // Check the final status
  const afterUpdate = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN work_production_quantity IS NULL THEN 1 END) as null_quantities,
      COUNT(CASE WHEN work_production_quantity > 0 THEN 1 END) as with_quantities
    FROM work_cycles
  `);
  
  console.log('\n📊 After update status:', afterUpdate.rows[0]);
  
  // Show sample work cycles with quantities now
  const samples = await db.execute(sql`
    SELECT 
      id,
      work_production_number,
      work_production_quantity,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_routing_rec_name
    FROM work_cycles
    WHERE work_production_quantity > 0
      AND work_production_number IN (${sql.join(matchingMOs, sql`, `)})
    LIMIT 10
  `);
  
  console.log('\nSample work cycles with quantities:');
  samples.rows.forEach(row => {
    console.log(`- MO: ${row.work_production_number}, Qty: ${row.work_production_quantity}, Operator: ${row.work_cycles_operator_rec_name}, WC: ${row.work_cycles_work_center_rec_name}`);
  });
  
  process.exit(0);
}

populateQuantitiesFallback().catch(console.error);