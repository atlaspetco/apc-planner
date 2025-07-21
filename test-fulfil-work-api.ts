import fetch from 'node-fetch';

async function testFulfilWorkAPI() {
  const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  
  if (!FULFIL_ACCESS_TOKEN) {
    console.error('FULFIL_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const url = 'https://apc.fulfil.io/api/v2/model/production.work/search_read';
  
  const body = {
    filters: [
      ['state', 'in', ['done', 'finished']]
    ],
    fields: [
      'id',
      'operator.rec_name',
      'rec_name',
      'production',
      'work_center.category',
      'operation.rec_name',
      'cycles.duration',
      'cycles.work_center.rec_name',
      'state',
      'production.routing.rec_name',
      'production.quantity',
      'create_date',
      'production.planned_date',
      'production.priority'
    ],
    limit: 5  // Just test with 5 records
  };

  try {
    console.log('Testing Fulfil API with production.work endpoint...');
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': FULFIL_ACCESS_TOKEN
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error (${response.status}):`, errorText);
      return;
    }

    const data = await response.json();
    console.log('\nResponse data:');
    console.log(JSON.stringify(data, null, 2));
    
    // Analyze the first record structure
    if (data && data.length > 0) {
      console.log('\nFirst record analysis:');
      const first = data[0];
      console.log('Fields found:');
      Object.keys(first).forEach(key => {
        console.log(`  ${key}: ${typeof first[key]} - ${JSON.stringify(first[key]).substring(0, 100)}`);
      });
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testFulfilWorkAPI();