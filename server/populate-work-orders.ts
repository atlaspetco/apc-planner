import { db } from './db.js';
import { workOrders } from '@shared/schema.js';

export async function populateWorkOrders() {
  try {
    // Fetch all production orders
    const response = await fetch('http://localhost:5000/api/production-orders');
    const productionOrders = await response.json();
    
    let insertedCount = 0;
    
    for (const po of productionOrders) {
      if (po.workOrders && Array.isArray(po.workOrders)) {
        for (const wo of po.workOrders) {
          try {
            // Check if work order already exists
            const existing = await db.select().from(workOrders).where(eq(workOrders.id, wo.id)).limit(1);
            
            if (existing.length === 0) {
              // Insert work order
              await db.insert(workOrders).values({
                id: wo.id,
                productionOrderId: po.id,
                workCenter: wo.workCenter || wo.originalWorkCenter,
                operation: wo.operation,
                status: wo.state === 'finished' ? 'completed' : wo.state,
                sequence: 1, // Default sequence
                priority: 'medium',
                assigned_operator_id: null, // Start unassigned
                routing: po.routing,
              });
              insertedCount++;
            }
          } catch (error) {
            console.error(`Error inserting work order ${wo.id}:`, error);
          }
        }
      }
    }
    
    console.log(`Populated ${insertedCount} work orders`);
    return insertedCount;
  } catch (error) {
    console.error('Error populating work orders:', error);
    throw error;
  }
}

// Import eq function
import { eq } from 'drizzle-orm';

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  populateWorkOrders()
    .then(count => {
      console.log(`Successfully populated ${count} work orders`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed to populate work orders:', error);
      process.exit(1);
    });
}