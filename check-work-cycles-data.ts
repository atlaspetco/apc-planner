import { db } from './server/db.js';
import { workCycles } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkWorkCycles() {
  // Count total work cycles
  const totalCount = await db.select({ count: sql<number>`COUNT(*)` })
    .from(workCycles);
  
  console.log('Total work cycles in database:', totalCount[0].count);
  
  // Count work cycles with production quantity
  const withQuantity = await db.select({ count: sql<number>`COUNT(*)` })
    .from(workCycles)
    .where(sql`work_production_quantity IS NOT NULL AND work_production_quantity > 0`);
  
  console.log('Work cycles with production quantity:', withQuantity[0].count);
  
  // Check a few sample records
  const samples = await db.select()
    .from(workCycles)
    .limit(5);
  
  console.log('\nSample work cycles:');
  samples.forEach(cycle => {
    console.log(`- ID: ${cycle.id}, Quantity: ${cycle.work_production_quantity}, MO: ${cycle.work_production_number}`);
  });
  
  process.exit(0);
}

checkWorkCycles().catch(console.error);