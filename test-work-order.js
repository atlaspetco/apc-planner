import fetch from 'node-fetch';

async function testWorkOrder() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  const baseUrl = "https://apc.fulfil.io";
  
  try {
    // Try to fetch work order 33603 directly
    const response = await fetch(`${baseUrl}/api/v2/model/production.work/33603`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      }
    });
    
    console.log('Response status:', response.status);
    
    if (response.status === 200) {
      const workOrder = await response.json();
      console.log('Work order 33603:', JSON.stringify({
        id: workOrder.id,
        state: workOrder.state,
        rec_name: workOrder.rec_name,
        production: workOrder.production,
        operator: workOrder.operator,
        employee: workOrder.employee,
        work_center: workOrder.work_center
      }, null, 2));
    } else {
      console.log('Error fetching work order:', await response.text());
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testWorkOrder();