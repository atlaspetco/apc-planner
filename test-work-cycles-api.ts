import fetch from 'node-fetch';

async function testWorkCyclesAPI() {
  const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  
  if (!FULFIL_ACCESS_TOKEN) {
    console.error('FULFIL_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const url = 'https://apc.fulfil.io/api/v2/model/production.work.cycles/search_read';
  
  const body = {
    filters: [
      ['state', '=', 'done']
    ],
    fields: [
      'id',
      'work',
      'work.production',
      'work.production.number',
      'work.production.quantity',
      'work.production.routing.rec_name',
      'work.operation.rec_name',
      'work.work_center.rec_name',
      'operator.rec_name',
      'quantity_done',
      'duration',
      'effective_date',
      'create_date'
    ],
    limit: 5
  };

  try {
    console.log('Testing Fulfil API with production.work.cycles endpoint...');
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
      
      console.log('\nDuration field:', first.duration);
      console.log('Work production quantity:', first['work.production.quantity']);
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testWorkCyclesAPI();