import { db } from './server/db.js';
import { workCycles } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkStates() {
  // Check distinct states
  const states = await db.execute(sql`
    SELECT DISTINCT state, COUNT(*) as count 
    FROM work_cycles 
    GROUP BY state
  `);
  
  console.log('Work cycle states:');
  states.rows.forEach(row => {
    console.log(`- State: "${row.state || 'NULL'}", Count: ${row.count}`);
  });
  
  // Check some samples with production quantity
  const samples = await db.select()
    .from(workCycles)
    .where(sql`work_production_quantity > 0`)
    .limit(10);
  
  console.log('\nSample work cycles with production quantity:');
  samples.forEach(cycle => {
    console.log(`- ID: ${cycle.id}, State: "${cycle.state}", Quantity: ${cycle.work_production_quantity}, MO: ${cycle.work_production_number}`);
  });
  
  process.exit(0);
}

checkStates().catch(console.error);