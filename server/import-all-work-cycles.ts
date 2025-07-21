import { db } from "./db.js";
import { workCycles, productionOrders } from "../shared/schema.js";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import fetch from 'node-fetch';

const FULFIL_API_KEY = process.env.FULFIL_ACCESS_TOKEN;
const FULFIL_API_URL = 'https://apc.fulfil.io/api/v2';

interface FulfilWorkCycle {
  id: number;
  work: { 
    id: number; 
    production: { 
      id?: number; 
      number?: string;
      routing?: { name?: string };
    };
    operation?: { rec_name?: string };
  };
  operator?: { rec_name?: string };
  work_center?: { rec_name?: string };
  duration?: number;
  quantity_done?: number;
  state?: string;
  create_date?: string;
  operation?: { rec_name?: string };
  rec_name?: string;
  "work.production.number"?: string;
  "work.production.routing.rec_name"?: string;
  "work.operation.rec_name"?: string;
  "work_center.rec_name"?: string;
  "operator.rec_name"?: string;
}

async function fetchAllWorkCycles() {
  console.log('Starting comprehensive work cycles import...');
  
  let allCycles: FulfilWorkCycle[] = [];
  let offset = 0;
  const limit = 500;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`Fetching batch at offset ${offset} (${limit} records per batch)...`);
    
    const response = await fetch(`${FULFIL_API_URL}/model/production.work.cycles/search_read`, {
      method: 'PUT',
      headers: {
        'X-API-KEY': FULFIL_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filters: [["state", "=", "done"]],
        fields: [
          "id",
          "work",
          "work.production.number",
          "work.production.routing.rec_name",
          "work.operation.rec_name",
          "operator.rec_name",
          "work_center.rec_name",
          "duration",
          "quantity_done",
          "state",
          "create_date",
          "rec_name"
        ],
        limit: limit,
        offset: offset,
        order: "id ASC"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch work cycles: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as FulfilWorkCycle[];
    
    if (data.length === 0) {
      hasMore = false;
    } else {
      allCycles = allCycles.concat(data);
      console.log(`Fetched ${data.length} cycles. Total so far: ${allCycles.length}`);
      
      if (data.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
        // Rate limiting - wait 1 second between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  return allCycles;
}

export async function importAllWorkCycles() {
  try {
    console.log('=== IMPORTING ALL WORK CYCLES FROM FULFIL ===');
    
    // Fetch all work cycles
    const cycles = await fetchAllWorkCycles();
    console.log(`Total work cycles fetched: ${cycles.length}`);
    
    // Clear existing data to avoid duplicates
    console.log('Clearing existing work cycles...');
    await db.delete(workCycles);
    
    // Process in batches
    const batchSize = 100;
    let inserted = 0;
    
    for (let i = 0; i < cycles.length; i += batchSize) {
      const batch = cycles.slice(i, i + batchSize);
      
      const validCycles = batch
        .filter(cycle => {
          // Basic validation
          const hasOperator = cycle["operator.rec_name"] || cycle.operator?.rec_name;
          const hasWorkCenter = cycle["work_center.rec_name"] || cycle.work_center?.rec_name;
          const hasDuration = cycle.duration && cycle.duration > 0;
          
          return hasOperator && hasWorkCenter && hasDuration;
        })
        .map(cycle => {
          // Extract data with multiple fallbacks
          const operatorName = cycle["operator.rec_name"] || cycle.operator?.rec_name || 'Unknown';
          const workCenterName = cycle["work_center.rec_name"] || cycle.work_center?.rec_name || 'Unknown';
          const operationName = cycle["work.operation.rec_name"] || 
                               cycle.work?.operation?.rec_name || 
                               cycle.operation?.rec_name || 
                               cycle.rec_name || 
                               'Unknown';
          const productionNumber = cycle["work.production.number"] || 
                                  cycle.work?.production?.number || 
                                  'Unknown';
          const routingName = cycle["work.production.routing.rec_name"] || 
                             cycle.work?.production?.routing?.name || 
                             'Unknown';
          
          return {
            id: cycle.id,
            work_id: cycle.work?.id || 0,
            work_production_id: cycle.work?.production?.id || 0,
            work_production_number: productionNumber,
            work_production_routing_rec_name: routingName,
            work_operation_rec_name: operationName,
            work_cycles_operator_rec_name: operatorName,
            work_cycles_work_center_rec_name: workCenterName,
            work_cycles_duration: cycle.duration || 0,
            quantity_done: cycle.quantity_done || 0,
            state: cycle.state || 'done',
            created_at: cycle.create_date ? new Date(cycle.create_date) : new Date()
          };
        });
      
      if (validCycles.length > 0) {
        await db.insert(workCycles).values(validCycles);
        inserted += validCycles.length;
        console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}: ${validCycles.length} cycles (Total: ${inserted})`);
      }
    }
    
    // Get final count
    const finalCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Total work cycles in database: ${finalCount[0].count}`);
    
    // Get some statistics
    const stats = await db.select({
      operators: sql<number>`count(distinct work_cycles_operator_rec_name)`,
      workCenters: sql<number>`count(distinct work_cycles_work_center_rec_name)`,
      routings: sql<number>`count(distinct work_production_routing_rec_name)`,
      minDate: sql<string>`min(created_at)`,
      maxDate: sql<string>`max(created_at)`
    }).from(workCycles);
    
    console.log('\n=== DATA STATISTICS ===');
    console.log(`Unique operators: ${stats[0].operators}`);
    console.log(`Unique work centers: ${stats[0].workCenters}`);
    console.log(`Unique routings: ${stats[0].routings}`);
    console.log(`Date range: ${stats[0].minDate} to ${stats[0].maxDate}`);
    
    return {
      totalImported: inserted,
      totalInDatabase: finalCount[0].count,
      uniqueOperators: stats[0].operators,
      uniqueWorkCenters: stats[0].workCenters,
      uniqueRoutings: stats[0].routings
    };
    
  } catch (error) {
    console.error('Error importing work cycles:', error);
    throw error;
  }
}

// If running directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  importAllWorkCycles()
    .then(result => {
      console.log('\nImport completed successfully:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\nImport failed:', error);
      process.exit(1);
    });
}