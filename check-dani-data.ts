import { db } from './server/db.js';
import { historicalUph, workCycles } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';

async function checkDaniData() {
  // Check what's in historical_uph for Dani Mayta
  const daniData = await db.select().from(historicalUph)
    .where(eq(historicalUph.operator, 'Dani Mayta'));

  console.log('Historical UPH for Dani Mayta:', daniData.length, 'records');
  daniData.forEach(d => {
    console.log(`  ${d.workCenter} + ${d.routing}: ${d.unitsPerHour} UPH (${d.observations} observations)`);
  });

  // Check if there are work cycles for Dani
  const daniCycles = await db.select().from(workCycles)
    .where(eq(workCycles.work_cycles_operator_rec_name, 'Dani Mayta'))
    .limit(10);

  console.log('\nWork cycles for Dani Mayta:', daniCycles.length, 'found');
  
  // Check specifically for Assembly + Lifetime Harness
  const specificCycles = await db.execute(sql`
    SELECT COUNT(*) as count 
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = 'Dani Mayta'
      AND work_production_routing_rec_name = 'Lifetime Harness'
      AND state = 'done'
  `);

  console.log('\nDani Mayta work cycles for Lifetime Harness:', specificCycles.rows[0].count);

  // Check what work centers Dani has worked on
  const workCenters = await db.execute(sql`
    SELECT DISTINCT work_cycles_work_center_rec_name 
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = 'Dani Mayta'
      AND work_production_routing_rec_name = 'Lifetime Harness'
  `);
  
  console.log('\nWork centers for Dani + Lifetime Harness:');
  workCenters.rows.forEach((row: any) => {
    console.log('  -', row.work_cycles_work_center_rec_name);
  });

  process.exit(0);
}

checkDaniData().catch(console.error);