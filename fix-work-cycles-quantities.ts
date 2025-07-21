import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { sql, eq, isNull, or } from 'drizzle-orm';

async function fixWorkCyclesQuantities() {
  console.log('🔧 Starting work_cycles quantity fix...');
  
  // First, get all production orders with their quantities
  const allProductionOrders = await db.select().from(productionOrders);
  const moQuantityMap = new Map<string, number>();
  
  allProductionOrders.forEach(po => {
    if (po.moNumber && po.quantity) {
      moQuantityMap.set(po.moNumber, po.quantity);
    }
  });
  
  console.log(`📊 Loaded ${moQuantityMap.size} production orders with quantities`);
  
  // Get all work cycles that need quantity updates
  const cyclesNeedingUpdate = await db
    .select()
    .from(workCycles)
    .where(
      sql`work_production_number IS NOT NULL AND (work_production_quantity IS NULL OR work_production_quantity = 0)`
    );
  
  console.log(`🔍 Found ${cyclesNeedingUpdate.length} work cycles needing quantity updates`);
  
  let updatedCount = 0;
  let notFoundCount = 0;
  
  // Update work cycles with quantities from production orders
  for (const cycle of cyclesNeedingUpdate) {
    if (!cycle.work_production_number) continue;
    
    const quantity = moQuantityMap.get(cycle.work_production_number);
    
    if (quantity && quantity > 0) {
      await db
        .update(workCycles)
        .set({ work_production_quantity: quantity })
        .where(eq(workCycles.id, cycle.id));
      
      updatedCount++;
      
      if (updatedCount % 100 === 0) {
        console.log(`✅ Updated ${updatedCount} work cycles...`);
      }
    } else {
      notFoundCount++;
    }
  }
  
  console.log(`\n📈 Update Summary:`);
  console.log(`✅ Updated ${updatedCount} work cycles with quantities from production orders`);
  console.log(`❌ ${notFoundCount} work cycles have MO numbers not found in production_orders table`);
  
  // Check the results
  const afterUpdate = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN work_production_quantity IS NULL THEN 1 END) as null_quantities,
      COUNT(CASE WHEN work_production_quantity > 0 THEN 1 END) as with_quantities
    FROM work_cycles
  `);
  
  console.log('\n📊 After update status:', afterUpdate.rows[0]);
  
  process.exit(0);
}

fixWorkCyclesQuantities().catch(console.error);