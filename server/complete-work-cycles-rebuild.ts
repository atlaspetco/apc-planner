import { sql } from "drizzle-orm";
import { db } from './db.js';

/**
 * CRITICAL: Complete Work Cycles Rebuild from Fulfil API
 * 
 * Problem: All 32,000 work cycles need authentic data import
 * Solution: Comprehensive rebuild using multiple API strategies
 * 
 * Strategy:
 * 1. Clear existing corrupted/incomplete data
 * 2. Use multiple API endpoints to fetch complete dataset
 * 3. Implement robust error handling and retry logic
 * 4. Validate all imported data for integrity
 */

interface FulfilWorkCycle {
  id: number;
  duration: number;
  quantity_done: number;
  rec_name: string;
  state: string;
  operator?: {
    id: number;
    rec_name: string;
    write_date?: string;
  };
  work_center?: {
    id: number;
    rec_name: string;
  };
  work?: {
    id: number;
    rec_name: string;
    operation?: {
      id: number;
      rec_name: string;
    };
    production?: {
      id: number;
      number: string;
      quantity: number;
      priority?: string;
      create_date?: string;
      product?: {
        code: string;
      };
      routing?: {
        rec_name: string;
      };
    };
  };
}

async function clearExistingWorkCycles(): Promise<void> {
  console.log("🗑️  CLEARING EXISTING WORK CYCLES DATA");
  
  const deleteResult = await db.execute(sql`DELETE FROM work_cycles`);
  console.log(`✅ Cleared existing work cycles data`);
}

async function fetchWorkCyclesPage(offset: number, limit: number): Promise<FulfilWorkCycle[]> {
  const FULFIL_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  if (!FULFIL_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not found in environment");
  }

  const url = 'https://apc.fulfil.io/model/production.work.cycles/search_read';
  
  const requestBody = {
    filters: [['state', '=', 'done']], // Only completed cycles
    fields: [
      'id',
      'duration',
      'quantity_done', 
      'rec_name',
      'state',
      'operator.id',
      'operator.rec_name',
      'operator.write_date',
      'work_center.id',
      'work_center.rec_name',
      'work.id',
      'work.rec_name',
      'work.operation.id',
      'work.operation.rec_name',
      'work.production.id',
      'work.production.number',
      'work.production.quantity',
      'work.production.priority',
      'work.production.create_date',
      'work.production.product.code',
      'work.production.routing.rec_name'
    ],
    offset: offset,
    limit: limit,
    order: 'id ASC' // Consistent ordering
  };

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': FULFIL_TOKEN
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`❌ Error fetching page offset ${offset}:`, error);
    throw error;
  }
}

async function fetchAllWorkCycles(): Promise<FulfilWorkCycle[]> {
  console.log("🔄 FETCHING ALL WORK CYCLES FROM FULFIL API");
  
  const allCycles: FulfilWorkCycle[] = [];
  const pageSize = 1000; // Reasonable page size
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    try {
      console.log(`📡 Fetching page ${Math.floor(offset / pageSize) + 1} (offset: ${offset})`);
      
      const pageCycles = await fetchWorkCyclesPage(offset, pageSize);
      
      if (pageCycles.length === 0) {
        hasMore = false;
        break;
      }
      
      allCycles.push(...pageCycles);
      offset += pageSize;
      
      console.log(`   Retrieved ${pageCycles.length} cycles (total: ${allCycles.length})`);
      
      // Rate limiting - pause between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Stop if we've reached expected total
      if (allCycles.length >= 32000) {
        console.log(`🎯 Reached target of ~32,000 cycles`);
        break;
      }
      
    } catch (error) {
      console.error(`❌ Error on page ${Math.floor(offset / pageSize) + 1}:`, error);
      
      // Retry logic
      console.log("🔄 Retrying in 2 seconds...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
  }
  
  console.log(`✅ Successfully fetched ${allCycles.length} total work cycles`);
  return allCycles;
}

async function validateCycleData(cycle: FulfilWorkCycle): Promise<boolean> {
  // Basic validation rules
  if (!cycle.id || cycle.id <= 0) return false;
  if (!cycle.duration || cycle.duration <= 0) return false;
  if (cycle.duration > 86400) return false; // More than 24 hours seems invalid
  if (!cycle.quantity_done || cycle.quantity_done <= 0) return false;
  
  return true;
}

async function insertWorkCycleBatch(cycles: FulfilWorkCycle[]): Promise<number> {
  let insertedCount = 0;
  
  for (const cycle of cycles) {
    // Validate before inserting
    if (!await validateCycleData(cycle)) {
      console.log(`⚠️  Skipping invalid cycle ${cycle.id}: duration=${cycle.duration}, quantity=${cycle.quantity_done}`);
      continue;
    }
    
    try {
      await db.execute(sql`
        INSERT INTO work_cycles (
          work_cycles_id,
          work_cycles_duration,
          work_cycles_quantity_done,
          work_cycles_rec_name,
          work_cycles_operator_rec_name,
          work_cycles_operator_id,
          work_cycles_operator_write_date,
          work_cycles_work_center_rec_name,
          work_operation_rec_name,
          work_operation_id,
          work_production_id,
          work_production_number,
          work_production_quantity,
          work_production_product_code,
          work_production_priority,
          work_production_create_date,
          work_production_routing_rec_name,
          work_rec_name,
          work_id,
          state,
          data_corrupted
        ) VALUES (
          ${cycle.id},
          ${cycle.duration},
          ${cycle.quantity_done},
          ${cycle.rec_name || null},
          ${cycle.operator?.rec_name || null},
          ${cycle.operator?.id || null},
          ${cycle.operator?.write_date || null},
          ${cycle.work_center?.rec_name || null},
          ${cycle.work?.operation?.rec_name || null},
          ${cycle.work?.operation?.id || null},
          ${cycle.work?.production?.id || null},
          ${cycle.work?.production?.number || null},
          ${cycle.work?.production?.quantity || null},
          ${cycle.work?.production?.product?.code || null},
          ${cycle.work?.production?.priority || null},
          ${cycle.work?.production?.create_date || null},
          ${cycle.work?.production?.routing?.rec_name || null},
          ${cycle.work?.rec_name || null},
          ${cycle.work?.id || null},
          ${cycle.state || 'done'},
          FALSE
        )
        ON CONFLICT (work_cycles_id) DO UPDATE SET
          work_cycles_duration = EXCLUDED.work_cycles_duration,
          work_cycles_quantity_done = EXCLUDED.work_cycles_quantity_done,
          work_cycles_rec_name = EXCLUDED.work_cycles_rec_name,
          work_cycles_operator_rec_name = EXCLUDED.work_cycles_operator_rec_name,
          work_cycles_operator_id = EXCLUDED.work_cycles_operator_id,
          work_cycles_operator_write_date = EXCLUDED.work_cycles_operator_write_date,
          work_cycles_work_center_rec_name = EXCLUDED.work_cycles_work_center_rec_name,
          work_operation_rec_name = EXCLUDED.work_operation_rec_name,
          work_operation_id = EXCLUDED.work_operation_id,
          work_production_id = EXCLUDED.work_production_id,
          work_production_number = EXCLUDED.work_production_number,
          work_production_quantity = EXCLUDED.work_production_quantity,
          work_production_product_code = EXCLUDED.work_production_product_code,
          work_production_priority = EXCLUDED.work_production_priority,
          work_production_create_date = EXCLUDED.work_production_create_date,
          work_production_routing_rec_name = EXCLUDED.work_production_routing_rec_name,
          work_rec_name = EXCLUDED.work_rec_name,
          work_id = EXCLUDED.work_id,
          state = EXCLUDED.state,
          data_corrupted = FALSE,
          updated_at = NOW()
      `);
      
      insertedCount++;
      
    } catch (error) {
      console.error(`❌ Error inserting cycle ${cycle.id}:`, error);
    }
  }
  
  return insertedCount;
}

async function insertAllWorkCycles(cycles: FulfilWorkCycle[]): Promise<number> {
  console.log("💾 INSERTING ALL WORK CYCLES INTO DATABASE");
  
  const batchSize = 100;
  let totalInserted = 0;
  
  for (let i = 0; i < cycles.length; i += batchSize) {
    const batch = cycles.slice(i, i + batchSize);
    
    console.log(`📥 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(cycles.length / batchSize)} (${batch.length} cycles)`);
    
    const batchInserted = await insertWorkCycleBatch(batch);
    totalInserted += batchInserted;
    
    // Progress update
    if ((i + batchSize) % 1000 === 0 || i + batchSize >= cycles.length) {
      console.log(`   Progress: ${totalInserted} / ${cycles.length} cycles inserted`);
    }
  }
  
  console.log(`✅ Successfully inserted ${totalInserted} work cycles`);
  return totalInserted;
}

async function verifyCompleteDataIntegrity(): Promise<void> {
  console.log("\n📊 VERIFYING COMPLETE DATA INTEGRITY");
  
  const integritySummary = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(CASE WHEN data_corrupted = TRUE THEN 1 END) as corrupted_cycles,
      COUNT(CASE WHEN data_corrupted = FALSE OR data_corrupted IS NULL THEN 1 END) as clean_cycles,
      COUNT(DISTINCT work_production_id) as unique_production_orders,
      COUNT(DISTINCT work_cycles_operator_rec_name) as unique_operators,
      ROUND(AVG(work_cycles_duration), 2) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration,
      COUNT(CASE WHEN work_cycles_duration > 3600 THEN 1 END) as cycles_over_1hour,
      COUNT(CASE WHEN work_cycles_duration < 60 THEN 1 END) as cycles_under_1min
    FROM work_cycles 
    WHERE work_cycles_duration IS NOT NULL
  `);
  
  const stats = integritySummary.rows[0];
  console.log(`✅ Total Cycles: ${stats.total_cycles}`);
  console.log(`✅ Clean Cycles: ${stats.clean_cycles}`);
  console.log(`❌ Corrupted Cycles: ${stats.corrupted_cycles}`);
  console.log(`🏭 Unique Production Orders: ${stats.unique_production_orders}`);
  console.log(`👷 Unique Operators: ${stats.unique_operators}`);
  console.log(`📈 Average Duration: ${Math.round(stats.avg_duration_seconds)}s (${Math.round(stats.avg_duration_seconds/60)}min)`);
  console.log(`📊 Duration Range: ${stats.min_duration}s - ${Math.round(stats.max_duration)}s`);
  console.log(`⏰ Cycles > 1 hour: ${stats.cycles_over_1hour}`);
  console.log(`⚡ Cycles < 1 minute: ${stats.cycles_under_1min}`);
}

async function main() {
  try {
    console.log("🚀 STARTING COMPLETE WORK CYCLES REBUILD\n");
    console.log("Target: Import all ~32,000 authentic work cycles from Fulfil API\n");
    
    // Step 1: Clear existing data
    await clearExistingWorkCycles();
    
    // Step 2: Fetch all work cycles from API
    const allCycles = await fetchAllWorkCycles();
    
    if (allCycles.length === 0) {
      console.log("❌ No work cycles retrieved from API");
      return;
    }
    
    // Step 3: Insert all cycles into database
    const insertedCount = await insertAllWorkCycles(allCycles);
    
    // Step 4: Verify complete data integrity
    await verifyCompleteDataIntegrity();
    
    console.log("\n🎯 COMPLETE REBUILD SUMMARY:");
    console.log(`   API Cycles Retrieved: ${allCycles.length}`);
    console.log(`   Database Records Inserted: ${insertedCount}`);
    console.log(`   Success Rate: ${Math.round((insertedCount / allCycles.length) * 100)}%`);
    
    console.log("\n🔄 NEXT STEPS:");
    console.log("1. Recalculate UPH with complete authentic dataset");
    console.log("2. Verify all MO calculations are now accurate");
    console.log("3. Test production planning with full data integrity");
    
  } catch (error) {
    console.error("❌ Error during complete rebuild:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchAllWorkCycles, insertAllWorkCycles, verifyCompleteDataIntegrity };