import { db } from './server/db.js';
import { workCycles } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkDates() {
  // Check a sample of work cycles dates
  const cycles = await db.select({
    id: workCycles.id,
    createdAt: workCycles.createdAt,
    write_date: workCycles.work_cycles_operator_write_date
  })
  .from(workCycles)
  .limit(10);

  console.log('Sample work cycles dates:');
  cycles.forEach(c => {
    console.log(`ID: ${c.id}, createdAt: ${c.createdAt}, write_date: ${c.write_date}`);
  });

  // Check distinct dates
  const distinctDates = await db.select({
    write_date: workCycles.work_cycles_operator_write_date,
    count: sql`count(*)`
  })
  .from(workCycles)
  .groupBy(workCycles.work_cycles_operator_write_date)
  .orderBy(workCycles.work_cycles_operator_write_date)
  .limit(10);

  console.log('\nDistinct write dates:');
  distinctDates.forEach(d => {
    console.log(`Date: ${d.write_date}, Count: ${d.count}`);
  });

  process.exit(0);
}

checkDates().catch(console.error);