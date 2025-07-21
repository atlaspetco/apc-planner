// Set a test database URL for this script
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// Import the accurate UPH calculation
import { calculateAccurateUPH } from './server/accurate-uph-calculation.js';

async function testDirectUph() {
  console.log('Testing accurate UPH calculation directly...\n');
  
  try {
    const result = await calculateAccurateUPH();
    
    console.log('Calculation completed successfully!');
    console.log(`Total work cycles processed: ${result.totalCycles}`);
    console.log(`MO groups created: ${result.moGroups}`);
    console.log(`Operator/routing groups: ${result.operatorGroups}`);
    console.log(`UPH records inserted: ${result.inserted}`);
    
    if (result.calculations.length > 0) {
      console.log('\nSample calculations:');
      result.calculations.slice(0, 3).forEach((calc, index) => {
        console.log(`\n${index + 1}. ${calc.operatorName} | ${calc.workCenter} | ${calc.routing}`);
        console.log(`   Average UPH: ${calc.averageUph} (from ${calc.moCount} MOs)`);
        console.log(`   Total: ${calc.totalQuantity} units in ${calc.totalHours} hours`);
        if (calc.individualMos && calc.individualMos.length > 0) {
          console.log('   Individual MO UPH values:');
          calc.individualMos.slice(0, 3).forEach(mo => {
            console.log(`     - ${mo.moNumber}: ${mo.uph} UPH (${mo.quantity} units in ${mo.hours}h)`);
          });
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nThis test requires a DATABASE_URL environment variable to be set.');
    console.log('The calculation uses the work_cycles table to compute accurate UPH values.');
  }
}

testDirectUph();