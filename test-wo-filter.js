import fetch from 'node-fetch';

async function testWorkOrderFilter() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // Test 1: Get all work orders for production 190554 without any state filter
    console.log('Test 1: Fetching all work orders for production 190554 (MO195423)...');
    const response1 = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [['production', '=', 190554]],
        fields: ['id', 'state', 'rec_name', 'operator.rec_name']
      })
    });
    
    const data1 = await response1.json();
    console.log('All work orders:', JSON.stringify(data1, null, 2));
    
    // Test 2: Get only non-finished work orders
    console.log('\nTest 2: Fetching non-finished work orders for production 190554...');
    const response2 = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [
          ['production', '=', 190554],
          ['state', '!=', 'finished']
        ],
        fields: ['id', 'state', 'rec_name', 'operator.rec_name']
      })
    });
    
    const data2 = await response2.json();
    console.log('Non-finished work orders:', JSON.stringify(data2, null, 2));
    
    // Test 3: Get only finished work orders
    console.log('\nTest 3: Fetching finished work orders for production 190554...');
    const response3 = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [
          ['production', '=', 190554],
          ['state', '=', 'finished']
        ],
        fields: ['id', 'state', 'rec_name', 'operator.rec_name']
      })
    });
    
    const data3 = await response3.json();
    console.log('Finished work orders:', JSON.stringify(data3, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testWorkOrderFilter();