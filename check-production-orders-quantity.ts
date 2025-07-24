import { db } from "./server/db.js";
import { productionOrders, workCycles } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function checkProductionOrdersQuantity() {
  console.log("Checking production orders with quantities...");
  
  // Check if we have production orders with quantities
  const orders = await db
    .select({
      id: productionOrders.id,
      moNumber: productionOrders.moNumber,
      quantity: productionOrders.quantity,
    })
    .from(productionOrders)
    .where(sql`quantity IS NOT NULL AND quantity > 0`)
    .limit(10);
    
  console.log(`Found ${orders.length} production orders with quantities`);
  orders.forEach(order => {
    console.log(`MO: ${order.moNumber}, Quantity: ${order.quantity}`);
  });
  
  // Check how many work cycles need quantity updates
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workCycles)
    .where(sql`work_production_quantity IS NULL`);
    
  console.log(`\nWork cycles needing quantity update: ${count}`);
  
  // Check if we can match work cycles to production orders
  const matches = await db
    .select({
      cycleId: workCycles.work_cycles_id,
      moNumber: workCycles.work_production_number,
      poQuantity: productionOrders.quantity,
    })
    .from(workCycles)
    .leftJoin(productionOrders, sql`${workCycles.work_production_number} = ${productionOrders.moNumber}`)
    .where(sql`${workCycles.work_production_quantity} IS NULL AND ${productionOrders.quantity} IS NOT NULL`)
    .limit(5);
    
  console.log(`\nSample matches found: ${matches.length}`);
  matches.forEach(match => {
    console.log(`Cycle ${match.cycleId}: MO ${match.moNumber} -> Quantity ${match.poQuantity}`);
  });
}

checkProductionOrdersQuantity().catch(console.error);