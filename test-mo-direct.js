import fetch from 'node-fetch';

async function testMODirect() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // Direct GET request for production order 190554
    console.log('Fetching production order 190554 directly...');
    const response = await fetch(`${baseUrl}/api/v2/model/production.order/190554`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Production order 190554:', {
        id: data.id,
        rec_name: data.rec_name,
        state: data.state,
        planned_date: data.planned_date
      });
    } else {
      console.log('Status:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testMODirect();
