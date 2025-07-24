import { db } from './server/db';
import { workCycles, productionOrders } from './shared/schema';
import { eq, sql } from 'drizzle-orm';

async function populateProductionQuantities() {
  try {
    console.log("🔧 Populating production quantities in work_cycles...");
    
    // Update work_cycles with production quantity from production_orders
    const result = await db.execute(sql`
      UPDATE work_cycles wc
      SET work_production_quantity = po.quantity
      FROM production_orders po
      WHERE wc.work_production_number = po.mo_number
      AND wc.work_production_quantity IS NULL
    `);
    
    console.log("✅ Updated work_cycles with production quantities");
    
    // Check how many records were updated
    const checkResult = await db.select({
      total: sql`COUNT(*)`,
      withQuantity: sql`COUNT(CASE WHEN work_production_quantity IS NOT NULL THEN 1 END)`,
      nullQuantity: sql`COUNT(CASE WHEN work_production_quantity IS NULL THEN 1 END)`
    }).from(workCycles);
    
    console.log("📊 Work cycles status:");
    console.log(`  Total records: ${checkResult[0].total}`);
    console.log(`  With quantity: ${checkResult[0].withQuantity}`);
    console.log(`  Missing quantity: ${checkResult[0].nullQuantity}`);
    
    // If we still have nulls, check if production orders exist
    if (Number(checkResult[0].nullQuantity) > 0) {
      console.log("\n🔍 Checking for missing production orders...");
      
      const missingMOs = await db.execute(sql`
        SELECT DISTINCT work_production_number, COUNT(*) as cycle_count
        FROM work_cycles
        WHERE work_production_quantity IS NULL
        AND work_production_number IS NOT NULL
        GROUP BY work_production_number
        LIMIT 10
      `);
      
      console.log("Sample MOs with missing quantities:", missingMOs.rows);
      
      // Try to get quantities from CSV data pattern (some records might have quantity_done)
      console.log("\n🔧 Attempting fallback quantity population from work_cycles_quantity_done...");
      
      const fallbackResult = await db.execute(sql`
        UPDATE work_cycles
        SET work_production_quantity = work_cycles_quantity_done::INTEGER
        WHERE work_production_quantity IS NULL
        AND work_cycles_quantity_done IS NOT NULL
        AND work_cycles_quantity_done ~ '^[0-9]+$'
      `);
      
      console.log("✅ Applied fallback quantity population");
      
      // Final check
      const finalCheck = await db.select({
        total: sql`COUNT(*)`,
        withQuantity: sql`COUNT(CASE WHEN work_production_quantity IS NOT NULL THEN 1 END)`
      }).from(workCycles);
      
      console.log("\n📊 Final status:");
      console.log(`  Total records: ${finalCheck[0].total}`);
      console.log(`  With quantity: ${finalCheck[0].withQuantity} (${(Number(finalCheck[0].withQuantity) / Number(finalCheck[0].total) * 100).toFixed(1)}%)`);
    }
    
  } catch (error) {
    console.error("❌ Error populating quantities:", error);
  }
  
  process.exit(0);
}

populateProductionQuantities();