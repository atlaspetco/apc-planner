import { calculateUnifiedUph } from "./server/unified-uph-calculator.js";

async function debugAllUph() {
  const results = await calculateUnifiedUph();
  
  // Find ALL Courtney Banh's Assembly/Lifetime Pouch results
  const targets = results.filter(r => 
    r.operatorName === 'Courtney Banh' && 
    r.workCenter === 'Assembly' && 
    r.routing === 'Lifetime Pouch'
  );
  
  console.log('All Courtney Banh Assembly/Lifetime Pouch entries:');
  targets.forEach(t => {
    console.log(`- Operation: ${t.operation}, UPH: ${t.averageUph}, Observations: ${t.observationCount}`);
  });
  
  console.log('\nTotal entries:', targets.length);
  
  // Check if there's any summing happening
  const sum = targets.reduce((acc, t) => acc + t.averageUph, 0);
  console.log('Sum of all UPH values:', sum.toFixed(2));
}

debugAllUph().catch(console.error);
