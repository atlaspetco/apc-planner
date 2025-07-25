import { db } from './server/db';
import { workCycles } from './shared/schema';
import { eq, sql } from 'drizzle-orm';

const FULFIL_API_URL = 'https://apc.fulfil.io';
const FULFIL_TOKEN = process.env.FULFIL_ACCESS_TOKEN;

interface FulfilWorkCycle {
  id: number;
  duration: number;
  quantity_done: number;
  rec_name: string;
  operator: {
    id: number;
    rec_name: string;
  };
  work_center: {
    id: number;
    rec_name: string;
  };
  work: {
    id: number;
    rec_name: string;
    operation: {
      id: number;
      rec_name: string;
    };
    production: {
      id: number;
      number: string;
      quantity: number;
      product: {
        code: string;
      };
      routing: {
        rec_name: string;
      };
      create_date: string;
    };
  };
}

async function fetchWorkCyclesFromAPI(offset: number = 0, limit: number = 1000): Promise<FulfilWorkCycle[]> {
  console.log(`📡 Fetching work cycles from Fulfil API (offset: ${offset}, limit: ${limit})`);
  
  const url = `${FULFIL_API_URL}/api/v2/model/production.work.cycles`;
  
  const requestBody = {
    method: 'search_read',
    args: [
      [['state', '=', 'done']], // Only completed cycles
      [
        'id',
        'duration',
        'quantity_done', 
        'rec_name',
        'operator.id',
        'operator.rec_name',
        'work_center.id',
        'work_center.rec_name',
        'work.id',
        'work.rec_name',
        'work.operation.id',
        'work.operation.rec_name',
        'work.production.id',
        'work.production.number',
        'work.production.quantity',
        'work.production.product.code',
        'work.production.routing.rec_name',
        'work.production.create_date'
      ],
      offset,
      limit
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': FULFIL_TOKEN!
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Fetched ${data.length} work cycles`);
    
    return data;
  } catch (error) {
    console.error("❌ Error fetching work cycles:", error);
    throw error;
  }
}

async function parseDuration(duration: any): Promise<number> {
  if (typeof duration === 'number') {
    return duration;
  }
  
  if (typeof duration === 'string') {
    // Handle "HH:MM:SS" format
    const parts = duration.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  
  return 0;
}

async function importWorkCyclesFromAPI() {
  console.log('=== STARTING FULFIL API WORK CYCLES IMPORT ===');
  
  if (!FULFIL_TOKEN) {
    throw new Error('FULFIL_ACCESS_TOKEN not configured');
  }

  // Clear existing data
  console.log('🧹 Clearing existing work cycles...');
  await db.delete(workCycles);
  
  let totalImported = 0;
  let offset = 0;
  const limit = 1000;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const cycles = await fetchWorkCyclesFromAPI(offset, limit);
      
      if (cycles.length === 0) {
        hasMore = false;
        break;
      }
      
      // Process cycles in batches
      const batchSize = 100;
      for (let i = 0; i < cycles.length; i += batchSize) {
        const batch = cycles.slice(i, i + batchSize);
        
        const insertData = [];
        for (const cycle of batch) {
          // Skip invalid records
          if (!cycle.operator?.rec_name || !cycle.work_center?.rec_name) {
            continue;
          }
          
          const durationSeconds = await parseDuration(cycle.duration);
          if (durationSeconds <= 0) {
            continue;
          }
          
          insertData.push({
            work_cycles_id: cycle.id,
            work_cycles_duration: durationSeconds,
            work_cycles_rec_name: cycle.rec_name,
            work_cycles_operator_rec_name: cycle.operator.rec_name,
            work_cycles_operator_id: cycle.operator.id,
            work_cycles_work_center_rec_name: cycle.work_center.rec_name,
            work_cycles_quantity_done: cycle.quantity_done || 0,
            work_production_id: cycle.work?.production?.id || null,
            work_production_number: cycle.work?.production?.number || null,
            work_production_product_code: cycle.work?.production?.product?.code || null,
            work_production_quantity: cycle.work?.production?.quantity || null,
            work_production_routing_rec_name: cycle.work?.production?.routing?.rec_name || null,
            work_production_create_date: cycle.work?.production?.create_date ? new Date(cycle.work.production.create_date) : null,
            work_rec_name: cycle.work?.rec_name || null,
            work_operation_rec_name: cycle.work?.operation?.rec_name || null,
            work_operation_id: cycle.work?.operation?.id || null,
            work_id: cycle.work?.id || null,
            work_center_id: cycle.work_center.id,
            state: 'done',
            data_corrupted: false
          });
        }
        
        if (insertData.length > 0) {
          await db.insert(workCycles).values(insertData);
          totalImported += insertData.length;
          console.log(`💾 Imported batch: ${insertData.length} records (total: ${totalImported})`);
        }
      }
      
      offset += limit;
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Error at offset ${offset}:`, error);
      // Continue with next batch
      offset += limit;
    }
  }
  
  // Get final statistics
  const stats = await db.select({
    totalCount: sql<number>`count(*)`,
    operators: sql<number>`count(distinct work_cycles_operator_rec_name)`,
    workCenters: sql<number>`count(distinct work_cycles_work_center_rec_name)`,
    routings: sql<number>`count(distinct work_production_routing_rec_name)`
  }).from(workCycles);
  
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`✅ Total imported: ${totalImported}`);
  console.log(`📊 Database statistics:`);
  console.log(`   - Total work cycles: ${stats[0].totalCount}`);
  console.log(`   - Unique operators: ${stats[0].operators}`);
  console.log(`   - Unique work centers: ${stats[0].workCenters}`);
  console.log(`   - Unique routings: ${stats[0].routings}`);
  
  return stats[0];
}

// Run the import
importWorkCyclesFromAPI()
  .then(() => {
    console.log('✨ Work cycles import completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Import failed:', error);
    process.exit(1);
  });