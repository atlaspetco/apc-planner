import { db } from './server/db.js';
import { historicalUph } from './shared/schema.js';
import { eq, and, or } from 'drizzle-orm';

async function checkCourtneyData() {
  // Check what historical UPH data exists for Courtney and Cutting
  const courtneyData = await db.select().from(historicalUph)
    .where(
      and(
        eq(historicalUph.operator, 'Courtney Banh'),
        or(
          eq(historicalUph.workCenter, 'Cutting'),
          eq(historicalUph.routing, 'Cutting - Fabric')
        )
      )
    );

  console.log('Courtney Banh historical UPH data related to Cutting:');
  courtneyData.forEach(record => {
    console.log(`- Work Center: ${record.workCenter}, Routing: ${record.routing}, Operation: ${record.operation}, UPH: ${record.unitsPerHour}`);
  });

  // Also check if the dropdown is looking for the right key
  console.log('\nChecking key format for qualified operators:');
  console.log('Expected key format: operatorId-workCenter-routing');
  console.log('For Courtney (ID 29) and Cutting - Fabric:');
  console.log('- Key would be: 29-Cutting-Cutting - Fabric');

  process.exit(0);
}

checkCourtneyData().catch(console.error);