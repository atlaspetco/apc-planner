#!/usr/bin/env node

import fetch from 'node-fetch';

async function testLLAWorkOrders() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  if (!apiKey) {
    console.error('FULFIL_ACCESS_TOKEN not found');
    return;
  }

  const baseUrl = "https://apc.fulfil.io";
  
  // Test specific LLA MOs
  const llaProductionIds = [173363, 173364, 173365]; // MO178232, MO178233, MO178234
  
  console.log('Testing LLA work orders for production IDs:', llaProductionIds);
  
  try {
    const response = await fetch(`${baseUrl}/api/v2/model/production.work/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        filters: [
          ["production", "in", llaProductionIds]
        ],
        fields: [
          "id",
          "rec_name", 
          "work_center.rec_name",
          "operation.rec_name",
          "state",
          "production",
          "operator.rec_name"
        ]
      })
    });

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }

    const workOrders = await response.json();
    console.log(`\nFound ${workOrders.length} work orders total for LLA MOs\n`);
    
    // Group by production ID
    const byProduction = {};
    workOrders.forEach(wo => {
      if (!byProduction[wo.production]) {
        byProduction[wo.production] = [];
      }
      byProduction[wo.production].push(wo);
    });
    
    // Display results
    for (const prodId of llaProductionIds) {
      const wos = byProduction[prodId] || [];
      console.log(`Production ${prodId}: ${wos.length} work orders`);
      if (wos.length > 0) {
        wos.forEach(wo => {
          console.log(`  - WO${wo.id}: ${wo.rec_name}`);
          console.log(`    Work Center: ${wo['work_center.rec_name'] || 'None'}`);
          console.log(`    Operation: ${wo['operation.rec_name'] || 'None'}`);
          console.log(`    State: ${wo.state}`);
          console.log(`    Operator: ${wo['operator.rec_name'] || 'None'}`);
        });
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error fetching work orders:', error);
  }
}

testLLAWorkOrders();
