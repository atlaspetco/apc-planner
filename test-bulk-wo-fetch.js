#!/usr/bin/env node

import fetch from 'node-fetch';

async function testBulkWorkOrderFetch() {
  const apiKey = process.env.FULFIL_ACCESS_TOKEN;
  
  if (!apiKey) {
    console.error('FULFIL_ACCESS_TOKEN not set');
    process.exit(1);
  }

  console.log('Testing bulk work order fetch...\n');

  // First, get some manufacturing orders
  const moResponse = await fetch('https://apc.fulfil.io/api/v2/model/manufacturing_order/search_read', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({
      filters: [
        ["state", "in", ["waiting", "assigned", "running", "finished"]]
      ],
      fields: ["id", "rec_name", "state"],
      limit: 5
    })
  });

  const mos = await moResponse.json();
  console.log(`Found ${mos.length} manufacturing orders`);
  
  const moIds = mos.map(mo => mo.id);
  console.log('MO IDs:', moIds);
  console.log('MO details:', mos.map(mo => `${mo.rec_name} (${mo.state})`).join(', '));

  // Now fetch work orders for these MOs
  console.log('\nFetching work orders for these MOs...');
  
  const woResponse = await fetch('https://apc.fulfil.io/api/v2/model/production.work/search_read', {
    method: 'PUT', 
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({
      filters: [
        ["production", "in", moIds],
        ["state", "in", ["draft", "waiting", "assigned", "running", "done", "finished"]]
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

  if (!woResponse.ok) {
    console.error(`Work order fetch failed: ${woResponse.status}`);
    const errorText = await woResponse.text();
    console.error('Error:', errorText);
    return;
  }

  const workOrders = await woResponse.json();
  console.log(`\nFound ${workOrders.length} work orders total`);

  // Group work orders by MO
  const woByMO = {};
  workOrders.forEach(wo => {
    const moId = wo.production;
    if (!woByMO[moId]) woByMO[moId] = [];
    woByMO[moId].push(wo);
  });

  // Show results
  mos.forEach(mo => {
    const wos = woByMO[mo.id] || [];
    console.log(`\nMO ${mo.rec_name} (ID: ${mo.id}): ${wos.length} work orders`);
    if (wos.length > 0) {
      wos.forEach(wo => {
        console.log(`  - WO${wo.id}: ${wo.rec_name} | state: ${wo.state} | operator: ${wo['operator.rec_name'] || 'None'}`);
      });
    }
  });

  // Check for any work orders not matching our MOs
  const unmatchedWOs = workOrders.filter(wo => !moIds.includes(wo.production));
  if (unmatchedWOs.length > 0) {
    console.log(`\nWarning: ${unmatchedWOs.length} work orders have production IDs not in our MO list`);
    console.log('Unmatched production IDs:', [...new Set(unmatchedWOs.map(wo => wo.production))]);
  }
}

testBulkWorkOrderFetch().catch(console.error);