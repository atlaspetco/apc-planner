import fetch from 'node-fetch';

async function testMO195423() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // First get the MO195423 details
    console.log('Fetching MO195423 details...');
    const moResponse = await fetch(`${baseUrl}/api/v2/model/production.order/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [['rec_name', '=', 'MO195423']],
        fields: ['id', 'rec_name', 'state']
      })
    });
    
    const moData = await moResponse.json();
    console.log('MO195423 data:', JSON.stringify(moData, null, 2));
    
    if (moData.length > 0) {
      const moId = moData[0].id;
      console.log(`\nFetching work orders for production ID ${moId}...`);
      
      // Now fetch work orders for this production ID
      const woResponse = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: JSON.stringify({
          filters: [['production', '=', moId]],
          fields: [
            'id',
            'production',
            'rec_name',
            'work_center.rec_name',
            'operation.rec_name', 
            'quantity_done',
            'state',
            'operator.rec_name',
            'operator.id'
          ]
        })
      });
      
      const woData = await woResponse.json();
      console.log('Work orders:', JSON.stringify(woData, null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testMO195423();
