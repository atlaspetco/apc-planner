import { db } from './server/db.js';
import { historicalUph } from './shared/schema.js';
import { eq, and, or } from 'drizzle-orm';

async function checkCuttingFabricData() {
  // Check if 'Cutting - Fabric' exists as an operation
  const cuttingFabricData = await db.select().from(historicalUph)
    .where(
      or(
        eq(historicalUph.operation, 'Cutting - Fabric'),
        eq(historicalUph.routing, 'Cutting - Fabric')
      )
    );

  console.log('Historical UPH data for Cutting - Fabric:');
  console.log('Total records found:', cuttingFabricData.length);
  
  if (cuttingFabricData.length > 0) {
    console.log('\nFirst few records:');
    cuttingFabricData.slice(0, 5).forEach(record => {
      console.log(`- Operator: ${record.operator}, Work Center: ${record.workCenter}, Routing: ${record.routing}, Operation: ${record.operation}, UPH: ${record.unitsPerHour}`);
    });
  }

  // Also check what Courtney has for Cutting work center
  const courtneyAllData = await db.select().from(historicalUph)
    .where(eq(historicalUph.operator, 'Courtney Banh'));

  console.log('\n\nAll Courtney Banh historical UPH data:');
  courtneyAllData.forEach(record => {
    console.log(`- Work Center: ${record.workCenter}, Routing: ${record.routing}, Operation: ${record.operation}`);
  });

  process.exit(0);
}

checkCuttingFabricData().catch(console.error);