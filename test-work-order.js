import fetch from 'node-fetch';

async function testWorkOrder() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // First, try to search for work order 33603 by ID
    console.log('Searching for work order 33603 using search_read...');
    const searchResponse = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [['id', '=', 33603]],
        fields: [
          'id', 'state', 'rec_name', 'production', 'production.number',
          'operator', 'operator.rec_name',
          'work_center', 'work_center.rec_name', 'operation', 'operation.name'
        ]
      })
    });
    
    console.log('Search response status:', searchResponse.status);
    
    if (searchResponse.status === 200) {
      const results = await searchResponse.json();
      console.log('Search results:', JSON.stringify(results, null, 2));
    } else {
      console.log('Search error:', await searchResponse.text());
    }
    
    // Also try searching for finished work orders for MO195423
    console.log('\nSearching for finished work orders in MO195423...');
    const moSearchResponse = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [
          ['production.number', '=', 'MO195423'],
          ['state', '=', 'finished']
        ],
        fields: [
          'id', 'state', 'rec_name', 'production', 'production.number',
          'operator', 'operator.rec_name',
          'work_center', 'work_center.rec_name', 'operation', 'operation.name'
        ]
      })
    });
    
    console.log('MO search response status:', moSearchResponse.status);
    
    if (moSearchResponse.status === 200) {
      const moResults = await moSearchResponse.json();
      console.log('MO195423 finished work orders:', JSON.stringify(moResults, null, 2));
    } else {
      console.log('MO search error:', await moSearchResponse.text());
    }
    
    // Try broader search for all states of MO195423
    console.log('\nSearching for ALL work orders in MO195423...');
    const allWoResponse = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [['production.number', '=', 'MO195423']],
        fields: [
          'id', 'state', 'rec_name', 'operator', 'operator.rec_name',
          'work_center', 'work_center.rec_name', 'operation', 'operation.name'
        ]
      })
    });
    
    console.log('All WO search response status:', allWoResponse.status);
    
    if (allWoResponse.status === 200) {
      const allResults = await allWoResponse.json();
      console.log('MO195423 ALL work orders:', JSON.stringify(allResults, null, 2));
    } else {
      console.log('All WO search error:', await allWoResponse.text());
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testWorkOrder();