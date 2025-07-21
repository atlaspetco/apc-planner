import { db } from './server/db.js';
import { productionOrders } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkProductionOrders() {
  const count = await db.execute(sql`SELECT COUNT(*) as count FROM production_orders`);
  console.log('Total production orders:', count.rows[0].count);
  
  const sample = await db.select().from(productionOrders).limit(10);
  console.log('\nSample production orders:');
  sample.forEach(po => {
    console.log(`- ID: ${po.id}, MO: ${po.moNumber}, Qty: ${po.quantity}, Product: ${po.productName}, Routing: ${po.routing}`);
  });
  
  // Check how many have quantities
  const withQty = await db.execute(sql`
    SELECT COUNT(*) as count 
    FROM production_orders 
    WHERE quantity IS NOT NULL AND quantity > 0
  `);
  console.log('\nProduction orders with quantities:', withQty.rows[0].count);
  
  process.exit(0);
}

checkProductionOrders().catch(console.error);