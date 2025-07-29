import { db } from './server/db.js';
import { uphData, operators } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkCuttingData() {
  const cuttingData = await db.select().from(uphData).where(eq(uphData.workCenter, 'Cutting')).limit(10);
  console.log('Cutting UPH data count:', cuttingData.length);
  console.log('Sample Cutting data:', cuttingData.slice(0, 3));

  const allWorkCenters = await db.selectDistinct({ workCenter: uphData.workCenter }).from(uphData);
  console.log('All unique work centers in uphData:', allWorkCenters);

  const cuttingOperators = await db.select().from(operators);
  const withCuttingEnabled = cuttingOperators.filter(op => op.workCenters?.includes('Cutting'));
  console.log('Operators with Cutting work center enabled:', withCuttingEnabled.map(op => op.name));
  
  // Check if any operators have UPH data for Cutting
  const operatorsWithCuttingUPH = new Set<string>();
  for (const data of cuttingData) {
    operatorsWithCuttingUPH.add(data.operatorName);
  }
  console.log('Operators with Cutting UPH data:', Array.from(operatorsWithCuttingUPH));
  
  process.exit(0);
}

checkCuttingData();