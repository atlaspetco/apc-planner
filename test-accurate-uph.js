import fetch from 'node-fetch';

async function testAccurateUph() {
  console.log('Testing accurate UPH calculation...\n');
  
  try {
    // Call the calculate endpoint
    console.log('Calling /api/uph/calculate...');
    const calculateResponse = await fetch('http://localhost:5000/api/uph/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const calculateResult = await calculateResponse.json();
    console.log('Calculate result:', JSON.stringify(calculateResult, null, 2));
    
    if (calculateResult.success) {
      // Fetch the historical UPH data to verify
      console.log('\nFetching historical UPH data...');
      const historicalResponse = await fetch('http://localhost:5000/api/uph/historical');
      const historicalData = await historicalResponse.json();
      
      console.log(`\nFound ${historicalData.length} UPH records`);
      
      // Show a sample of the data
      if (historicalData.length > 0) {
        console.log('\nSample UPH records:');
        historicalData.slice(0, 5).forEach((record, index) => {
          console.log(`\n${index + 1}. ${record.operator} | ${record.workCenter} | ${record.routing}`);
          console.log(`   UPH: ${record.unitsPerHour}, Observations: ${record.observations}`);
          console.log(`   Total: ${record.totalQuantity} units in ${record.totalHours} hours`);
        });
      }
      
      // Check for specific known operators
      console.log('\n\nChecking for known operators:');
      const knownOperators = ['Mark Neiderer', 'Koren Mast', 'Annie Schlabach'];
      knownOperators.forEach(operatorName => {
        const operatorRecords = historicalData.filter(r => r.operator === operatorName);
        if (operatorRecords.length > 0) {
          console.log(`\n${operatorName}: ${operatorRecords.length} records`);
          operatorRecords.forEach(record => {
            console.log(`  - ${record.workCenter}/${record.routing}: ${record.unitsPerHour} UPH (${record.observations} MOs)`);
          });
        } else {
          console.log(`\n${operatorName}: No records found`);
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAccurateUph();