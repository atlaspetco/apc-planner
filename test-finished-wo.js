import { db } from "./server/db.js";
import { workOrders, workOrderAssignments } from "./shared/schema.js";
import { eq } from "drizzle-orm";

async function createFinishedWorkOrder() {
  try {
    console.log("Creating finished work order test scenario...");
    
    // Update work order 33470 to be finished
    await db.update(workOrders)
      .set({ 
        state: 'finished',
        employee_name: 'Dani Mayta',
        employee_id: 40 
      })
      .where(eq(workOrders.id, 33470));
    
    console.log("Updated work order 33470 to finished state with Dani Mayta as operator");
    
    // Create assignment for the finished work order
    await db.insert(workOrderAssignments).values({
      workOrderId: 33470,
      operatorId: 40, // Dani Mayta
      assignedAt: new Date(),
      isActive: true,
      isAutoAssigned: false,
      assignedBy: 'fulfil_sync',
      autoAssignReason: 'Completed by Dani Mayta in Fulfil',
      autoAssignConfidence: 1.0
    }).onConflictDoNothing();
    
    console.log("Created assignment for finished work order");
    
    // Verify the update
    const result = await db.select().from(workOrders).where(eq(workOrders.id, 33470));
    console.log("Verification - Work Order 33470:", result[0]);
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit();
  }
}

createFinishedWorkOrder();
