import { db } from "./server/db";
import { workCycles, productionOrders } from "./shared/schema";
import { sql } from "drizzle-orm";

async function populateProductionQuantities() {
  try {
    console.log("Starting to populate work_production_quantity field...");
    
    // Get all unique production order numbers from work cycles
    const uniqueMoNumbers = await db
      .selectDistinct({ moNumber: workCycles.work_production_number })
      .from(workCycles)
      .where(sql`${workCycles.work_production_number} IS NOT NULL`);
    
    console.log(`Found ${uniqueMoNumbers.length} unique production orders in work cycles`);
    
    // Get production quantities from production orders table
    const moQuantities = await db
      .select({
        moNumber: productionOrders.moNumber,
        quantity: productionOrders.quantity
      })
      .from(productionOrders);
    
    // Create a map for quick lookup
    const quantityMap = new Map<string, number>();
    moQuantities.forEach(mo => {
      if (mo.moNumber && mo.quantity) {
        quantityMap.set(mo.moNumber, mo.quantity);
      }
    });
    
    console.log(`Found quantities for ${quantityMap.size} production orders`);
    
    // Update work cycles with production quantities
    let updatedCount = 0;
    for (const { moNumber } of uniqueMoNumbers) {
      if (moNumber && quantityMap.has(moNumber)) {
        const quantity = quantityMap.get(moNumber)!;
        
        const result = await db
          .update(workCycles)
          .set({ work_production_quantity: quantity })
          .where(sql`${workCycles.work_production_number} = ${moNumber}`);
        
        updatedCount++;
        console.log(`Updated ${moNumber} with quantity ${quantity}`);
      }
    }
    
    console.log(`\nSuccessfully updated ${updatedCount} production orders with quantities`);
    
    // Verify the update
    const verifyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(workCycles)
      .where(sql`${workCycles.work_production_quantity} IS NOT NULL`);
    
    console.log(`Verification: ${verifyCount[0].count} work cycles now have production quantities`);
    
  } catch (error) {
    console.error("Error populating production quantities:", error);
  } finally {
    process.exit(0);
  }
}

populateProductionQuantities();