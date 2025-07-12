import { db } from "./db.js";
import { productionOrders, workOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

interface FulfilOrder {
  id: number;
  moNumber: string;
  productName: string;
  quantity: number;
  status: string;
  routing: string;
  routingName: string;
  dueDate: string;
  fulfilId: number;
  workOrders: Array<{
    id: number;
    workCenter: string;
    operation: string;
    state: string;
    quantity: number;
  }>;
}

export async function syncFulfilToDatabase(fulfilOrders: FulfilOrder[]) {
  let syncedPOs = 0;
  let syncedWOs = 0;
  
  console.log(`Starting sync of ${fulfilOrders.length} production orders from Fulfil`);
  
  for (const order of fulfilOrders) {
    try {
      // Check if production order exists
      const existingPO = await db
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.fulfilId, order.fulfilId))
        .limit(1);
      
      let localPOId: number;
      
      if (existingPO.length === 0) {
        // Create new production order
        const [newPO] = await db.insert(productionOrders).values({
          moNumber: order.moNumber,
          productName: order.productName,
          quantity: order.quantity,
          status: order.status,
          routing: order.routing,
          dueDate: new Date(order.dueDate),
          fulfilId: order.fulfilId,
        }).returning();
        
        localPOId = newPO.id;
        syncedPOs++;
        console.log(`Created new production order: ${order.moNumber} (ID: ${localPOId})`);
      } else {
        // Update existing production order
        await db
          .update(productionOrders)
          .set({
            productName: order.productName,
            quantity: order.quantity,
            status: order.status,
            routing: order.routing,
            dueDate: new Date(order.dueDate),
          })
          .where(eq(productionOrders.fulfilId, order.fulfilId));
        
        localPOId = existingPO[0].id;
        console.log(`Updated existing production order: ${order.moNumber} (ID: ${localPOId})`);
      }
      
      // Sync work orders for this production order
      for (const wo of order.workOrders) {
        const existingWO = await db
          .select()
          .from(workOrders)
          .where(eq(workOrders.fulfilId, wo.id))
          .limit(1);
        
        if (existingWO.length === 0) {
          // Create new work order
          await db.insert(workOrders).values({
            productionOrderId: localPOId,
            workCenter: wo.workCenter,
            operation: wo.operation,
            routing: order.routing,
            fulfilId: wo.id,
            quantityRequired: order.quantity,
            quantityDone: wo.quantity,
            status: wo.state === "request" ? "Pending" : wo.state,
            sequence: 1,
            estimatedHours: null, // Only use actual data
            actualHours: null,
            assignedOperatorId: null,
            operatorName: null,
          });
          
          syncedWOs++;
          console.log(`Created work order: ${wo.id} for ${order.moNumber} - ${wo.workCenter}`);
        } else {
          // Update existing work order
          await db
            .update(workOrders)
            .set({
              workCenter: wo.workCenter,
              operation: wo.operation,
              routing: order.routing,
              quantityRequired: order.quantity,
              quantityDone: wo.quantity,
              status: wo.state === "request" ? "Pending" : wo.state,
            })
            .where(eq(workOrders.fulfilId, wo.id));
          
          console.log(`Updated work order: ${wo.id} for ${order.moNumber} - ${wo.workCenter}`);
        }
      }
    } catch (error) {
      console.error(`Error syncing order ${order.moNumber}:`, error);
    }
  }
  
  console.log(`Sync complete: ${syncedPOs} production orders, ${syncedWOs} work orders created`);
  return { syncedPOs, syncedWOs };
}