import fetch from 'node-fetch';

async function testMOStates() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // Fetch production orders with different states
    console.log('Fetching production orders with running state...');
    const response = await fetch(`${baseUrl}/api/v2/model/production.order/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [
          ['state', 'in', ['waiting', 'assigned', 'running', 'finished']]
        ],
        fields: ['id', 'rec_name', 'state'],
        order: [['rec_name', 'DESC']],
        per_page: 10
      })
    });
    
    const data = await response.json();
    console.log('Production orders:', JSON.stringify(data, null, 2));
    
    // Check if MO195423 is in the list
    const mo195423 = data.find(mo => mo.rec_name === 'MO195423');
    if (mo195423) {
      console.log('\nFound MO195423:', mo195423);
      console.log('State:', mo195423.state);
    } else {
      console.log('\nMO195423 not found in results');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testMOStates();
