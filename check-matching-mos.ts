import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkMatchingMOs() {
  // Get all unique MO numbers from work_cycles
  const uniqueMOs = await db.execute(sql`
    SELECT DISTINCT work_production_number 
    FROM work_cycles 
    WHERE work_production_number IS NOT NULL
    ORDER BY work_production_number
  `);
  
  console.log(`Found ${uniqueMOs.rows.length} unique MO numbers in work_cycles`);
  
  // Get all MO numbers from production_orders
  const productionMOs = await db.select({ moNumber: productionOrders.moNumber }).from(productionOrders);
  const productionMOSet = new Set(productionMOs.map(p => p.moNumber));
  
  // Check which work_cycles MOs exist in production_orders
  let matchingCount = 0;
  let nonMatchingCount = 0;
  const matchingMOs = [];
  const nonMatchingMOs = [];
  
  for (const row of uniqueMOs.rows) {
    const mo = row.work_production_number;
    if (productionMOSet.has(mo)) {
      matchingCount++;
      matchingMOs.push(mo);
    } else {
      nonMatchingCount++;
      nonMatchingMOs.push(mo);
    }
  }
  
  console.log(`\n📊 Matching Analysis:`);
  console.log(`✅ ${matchingCount} MOs exist in both work_cycles and production_orders`);
  console.log(`❌ ${nonMatchingCount} MOs exist only in work_cycles`);
  
  console.log(`\nSample matching MOs:`, matchingMOs.slice(0, 10));
  console.log(`\nSample non-matching MOs:`, nonMatchingMOs.slice(0, 10));
  
  // Check how many work_cycles have matching MOs
  if (matchingMOs.length > 0) {
    const cyclesWithMatchingMOs = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM work_cycles
      WHERE work_production_number IN (${sql.join(matchingMOs.slice(0, 50), sql`, `)})
    `);
    
    console.log(`\n📈 Work cycles with matching MOs: ${cyclesWithMatchingMOs.rows[0].count}`);
  }
  
  process.exit(0);
}

checkMatchingMOs().catch(console.error);