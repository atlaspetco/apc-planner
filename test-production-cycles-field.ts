import fetch from 'node-fetch';

async function testProductionCyclesField() {
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
      'production_work_cycles_duration',
      'work_cycles.work_center.rec_name',
      'state',
      'production.routing.rec_name',
      'production.quantity',
      'create_date',
      'production.planned_date',
      'production.priority'
    ],
    limit: 5
  };

  try {
    console.log('Testing production.work endpoint with production_work_cycles_duration field...');
    
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
    
    // Check if duration field is populated
    if (data && data.length > 0) {
      console.log('\nChecking duration fields:');
      data.forEach((record: any, idx: number) => {
        console.log(`Record ${idx + 1}:`);
        console.log(`  production_work_cycles_duration: ${record.production_work_cycles_duration}`);
        console.log(`  production.quantity: ${record['production.quantity']}`);
        console.log(`  rec_name: ${record.rec_name}`);
      });
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testProductionCyclesField();