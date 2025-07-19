import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql } from "drizzle-orm";

async function populateQuantitiesWithFallback() {
  try {
    console.log("Populating work_production_quantity using MAX cycle quantity as fallback...");
    
    // Get unique MO numbers with their max quantities
    const moQuantities = await db
      .select({
        moNumber: workCycles.work_production_number,
        maxQuantity: sql<number>`MAX(${workCycles.work_cycles_quantity_done})`.as('maxQuantity')
      })
      .from(workCycles)
      .where(sql`${workCycles.work_production_number} IS NOT NULL 
        AND ${workCycles.work_cycles_quantity_done} > 0
        AND ${workCycles.work_production_quantity} IS NULL`)
      .groupBy(workCycles.work_production_number);
    
    console.log(`Found ${moQuantities.length} production orders needing quantity updates`);
    
    // Update each MO with its max quantity
    let updatedCount = 0;
    for (const { moNumber, maxQuantity } of moQuantities) {
      if (moNumber && maxQuantity) {
        await db
          .update(workCycles)
          .set({ work_production_quantity: maxQuantity })
          .where(sql`${workCycles.work_production_number} = ${moNumber} 
            AND ${workCycles.work_production_quantity} IS NULL`);
        
        updatedCount++;
        if (updatedCount % 100 === 0) {
          console.log(`Updated ${updatedCount} production orders...`);
        }
      }
    }
    
    console.log(`\nSuccessfully updated ${updatedCount} production orders with fallback quantities`);
    
    // Verify the update
    const verifyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(workCycles)
      .where(sql`${workCycles.work_production_quantity} IS NOT NULL`);
    
    console.log(`Verification: ${verifyCount[0].count} work cycles now have production quantities`);
    
    // Show sample of updated data
    const samples = await db
      .select({
        moNumber: workCycles.work_production_number,
        quantity: workCycles.work_production_quantity,
        operatorName: workCycles.work_cycles_operator_rec_name,
        workCenter: workCycles.work_cycles_work_center_rec_name
      })
      .from(workCycles)
      .where(sql`${workCycles.work_production_quantity} IS NOT NULL`)
      .limit(10);
    
    console.log("\nSample updated records:");
    samples.forEach(s => {
      console.log(`  ${s.moNumber}: Qty=${s.quantity}, Operator=${s.operatorName}, WorkCenter=${s.workCenter}`);
    });
    
  } catch (error) {
    console.error("Error populating quantities:", error);
  } finally {
    process.exit(0);
  }
}

populateQuantitiesWithFallback();