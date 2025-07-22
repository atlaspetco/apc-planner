import { calculateAccurateUPH } from './server/accurate-uph-calculation.js';

async function forceRecalculation() {
  console.log("🚀 Force-triggering accurate UPH recalculation with outlier filtering");
  
  try {
    const result = await calculateAccurateUPH();
    console.log("✅ Recalculation completed successfully");
    console.log(`Processed ${result.totalCycles} cycles into ${result.calculations.length} UPH calculations`);
    
    // Find Courtney Banh + Lifetime Pouch + Assembly
    const courtneyPouch = result.calculations.find(calc => 
      calc.operatorName === 'Courtney Banh' && 
      calc.routing === 'Lifetime Pouch' && 
      calc.workCenter === 'Assembly'
    );
    
    if (courtneyPouch) {
      console.log("\n🎯 Courtney Banh + Assembly + Lifetime Pouch result:");
      console.log(`   Average UPH: ${courtneyPouch.averageUph}`);
      console.log(`   MO Count: ${courtneyPouch.moCount}`);
      console.log(`   Total Quantity: ${courtneyPouch.totalQuantity}`);
      console.log(`   Total Hours: ${courtneyPouch.totalHours}`);
    } else {
      console.log("❌ Could not find Courtney Banh + Lifetime Pouch + Assembly in results");
    }
    
  } catch (error) {
    console.error("❌ Recalculation failed:", error);
  }
  
  process.exit(0);
}

forceRecalculation();