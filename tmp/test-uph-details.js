const fetch = require('node-fetch');

async function testUphDetails() {
  try {
    const response = await fetch('http://localhost:8000/api/uph/calculation-details?operatorName=Courtney%20Banh&workCenter=Assembly&routing=Lifetime%20Pouch');
    const data = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Summary:', data.summary);
    console.log('\nFirst 5 cycles:');
    if (data.cycles) {
      data.cycles.slice(0, 5).forEach(cycle => {
        console.log(`MO ${cycle.moNumber}: ${cycle.quantity} units / ${cycle.durationHours?.toFixed(2)} hrs = ${cycle.uph?.toFixed(2)} UPH`);
      });
    }
    
    // Look for the 40 unit / 4.23 hour example
    console.log('\nLooking for 40 unit MOs:');
    if (data.cycles) {
      data.cycles
        .filter(c => c.quantity === 40)
        .forEach(cycle => {
          console.log(`MO ${cycle.moNumber}: ${cycle.quantity} units / ${cycle.durationHours?.toFixed(2)} hrs = ${cycle.uph?.toFixed(2)} UPH`);
        });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testUphDetails();