import { db } from "./server/db.js";
import { workOrders } from "./shared/schema.js";

async function checkWorkOrders() {
  try {
    const allWorkOrders = await db.select().from(workOrders).limit(10);
    console.log("Total work orders found:", allWorkOrders.length);
    console.log("Work orders:", allWorkOrders);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit();
  }
}

checkWorkOrders();
