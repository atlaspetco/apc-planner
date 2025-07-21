import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkMoQuantityPopulation() {
  // Check how many work cycles have NULL MO quantities
  const nullQuantities = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN work_production_quantity IS NULL THEN 1 END) as null_quantities,
      COUNT(CASE WHEN work_production_quantity > 0 THEN 1 END) as with_quantities,
      COUNT(CASE WHEN work_production_number IS NOT NULL THEN 1 END) as with_mo_number
    FROM work_cycles
  `);
  
  console.log('Work cycles quantity status:', nullQuantities.rows[0]);
  
  // Check sample work cycles with MO numbers but no quantities
  const samplesWithMoNoQty = await db.execute(sql`
    SELECT 
      id,
      work_production_number,
      work_production_quantity,
      work_production_id,
      work_cycles_operator_rec_name,
      work_cycles_duration
    FROM work_cycles
    WHERE work_production_number IS NOT NULL 
      AND (work_production_quantity IS NULL OR work_production_quantity = 0)
    LIMIT 10
  `);
  
  console.log('\nSample work cycles with MO but no quantity:');
  samplesWithMoNoQty.rows.forEach(row => {
    console.log(`- ID: ${row.id}, MO: ${row.work_production_number}, Qty: ${row.work_production_quantity}, Production ID: ${row.work_production_id}`);
  });
  
  // Check if we have production orders with those MO numbers
  const moNumbers = samplesWithMoNoQty.rows
    .map(r => r.work_production_number)
    .filter(mo => mo)
    .slice(0, 5);
  
  if (moNumbers.length > 0) {
    console.log('\nChecking production orders for MOs:', moNumbers);
    const productionOrderData = await db
      .select()
      .from(productionOrders)
      .where(sql`mo_number IN (${sql.join(moNumbers, sql`, `)})`);
    
    console.log('Found production orders:', productionOrderData.length);
    productionOrderData.forEach(po => {
      console.log(`- MO: ${po.moNumber}, Quantity: ${po.quantity}`);
    });
  }
  
  process.exit(0);
}

checkMoQuantityPopulation().catch(console.error);