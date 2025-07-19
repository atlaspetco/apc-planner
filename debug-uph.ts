import { calculateUnifiedUph } from "./server/unified-uph-calculator.js";

async function debugUph() {
  const results = await calculateUnifiedUph();
  
  // Find Courtney Banh's Assembly/Lifetime Pouch result
  const target = results.find(r => 
    r.operatorName === 'Courtney Banh' && 
    r.workCenter === 'Assembly' && 
    r.routing === 'Lifetime Pouch'
  );
  
  console.log('Courtney Banh Assembly/Lifetime Pouch UPH:', target);
}

debugUph().catch(console.error);
