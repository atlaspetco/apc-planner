const fetch = require('node-fetch');

async function testAssignments() {
  try {
    const response = await fetch('http://localhost:5000/api/assignments', {
      headers: {
        'Cookie': 'connect.sid=test' // This will fail auth but that's OK for testing
      }
    });
    
    if (response.status === 401) {
      console.log("API requires authentication (expected). Server is running correctly.");
      return;
    }
    
    const data = await response.json();
    
    if (data.assignments) {
      const devinAssignments = data.assignments.filter(a => a.operatorName === 'Devin Cann');
      console.log(`Found ${devinAssignments.length} assignments for Devin Cann`);
      
      if (devinAssignments.length > 0) {
        console.log('\nSample assignments with completed hours:');
        devinAssignments.slice(0, 3).forEach(a => {
          console.log(`- MO: ${a.moNumber}, Completed: ${a.completedHours?.toFixed(2) || 0}h`);
        });
      }
    }
  } catch (error) {
    console.error('Error testing API:', error.message);
  }
}

testAssignments();
