import { db } from './server/db.js';
import { productionOrders } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function populateProductionOrders() {
  console.log('🔄 Fetching production orders from API...');
  
  try {
    const response = await fetch('http://localhost:5000/api/production-orders');
    const apiOrders = await response.json();
    
    console.log(`📊 Found ${apiOrders.length} production orders from API`);
    
    // Clear existing orders
    await db.delete(productionOrders);
    console.log('🗑️ Cleared existing production orders');
    
    // Insert new orders
    let insertedCount = 0;
    for (const order of apiOrders) {
      try {
        await db.insert(productionOrders).values({
          id: order.id,
          moNumber: order.moNumber,
          productName: order.productName,
          quantity: order.quantity,
          status: order.status || order.state,
          state: order.state,
          routing: order.routing,
          routingName: order.routingName || order.routing,
          dueDate: order.dueDate ? new Date(order.dueDate) : null,
          fulfilId: order.fulfilId || order.id,
          rec_name: order.rec_name || order.moNumber,
          planned_date: order.planned_date?.iso_string ? new Date(order.planned_date.iso_string) : null,
          product_code: order.product_code,
          createdAt: new Date()
        });
        insertedCount++;
        
        if (insertedCount % 10 === 0) {
          console.log(`✅ Inserted ${insertedCount} production orders...`);
        }
      } catch (error) {
        console.error(`❌ Failed to insert order ${order.moNumber}:`, error);
      }
    }
    
    console.log(`\n✅ Successfully inserted ${insertedCount} production orders`);
    
    // Verify the data
    const count = await db.execute(sql`SELECT COUNT(*) as count FROM production_orders`);
    console.log(`📊 Total production orders in database:`, count.rows[0].count);
    
    const withQty = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM production_orders 
      WHERE quantity IS NOT NULL AND quantity > 0
    `);
    console.log(`📊 Production orders with quantities:`, withQty.rows[0].count);
    
  } catch (error) {
    console.error('Failed to populate production orders:', error);
  }
  
  process.exit(0);
}

populateProductionOrders().catch(console.error);