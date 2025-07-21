import { db } from './server/db.js';
import { operators } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkCourtneySettings() {
  const courtney = await db.select().from(operators)
    .where(eq(operators.name, 'Courtney Banh'))
    .limit(1);

  if (courtney.length > 0) {
    console.log('Courtney Banh settings:');
    console.log('- ID:', courtney[0].id);
    console.log('- Work Centers:', courtney[0].workCenters);
    console.log('- Product Routings:', courtney[0].productRoutings);
    console.log('- Operations:', courtney[0].operations);
    console.log('- Is Active:', courtney[0].isActive);
  } else {
    console.log('Courtney Banh not found');
  }

  process.exit(0);
}

checkCourtneySettings().catch(console.error);