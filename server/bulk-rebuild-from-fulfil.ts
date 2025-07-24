import { sql } from "drizzle-orm";
import { db } from './db.js';

/**
 * CRITICAL: Bulk Rebuild Corrupted Data from Fulfil API
 * 
 * Since individual cycle API endpoints are returning 500 errors,
 * we'll use the bulk production.work.cycles endpoint to fetch
 * fresh data and replace corrupted records.
 */

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

async function fetchBulkWorkCyclesFromAPI(): Promise<FulfilWorkCycle[]> {
  const FULFIL_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  if (!FULFIL_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not found in environment");
  }

  console.log("🔄 FETCHING BULK WORK CYCLES FROM FULFIL API");
  
  const url = 'https://apc.fulfil.io/api/v2/model/production.work.cycles';
  
  const requestBody = {
    method: 'search_read',
    args: [
      [['state', '=', 'done']], // Only done cycles
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
        'work.operation.id',
        'work.operation.rec_name',
        'work.production.id',
        'work.production.number',
        'work.production.quantity',
        'work.production.product.code',
        'work.production.routing.rec_name',
        'work.production.create_date'
      ],
      0,    // offset
      10000 // limit - fetch more cycles
    ]
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
    console.log(`✅ Fetched ${data.length} work cycles from Fulfil API`);
    
    return data;
  } catch (error) {
    console.error("❌ Error fetching bulk work cycles:", error);
    throw error;
  }
}

async function getCorruptedCycleIds(): Promise<number[]> {
  console.log("🔍 IDENTIFYING CORRUPTED CYCLE IDs");
  
  const result = await db.execute(sql`
    SELECT DISTINCT work_cycles_id
    FROM work_cycles 
    WHERE data_corrupted = TRUE 
    AND work_cycles_id IS NOT NULL
    ORDER BY work_cycles_id
  `);

  const corruptedIds = result.rows.map(row => row.work_cycles_id as number);
  console.log(`📊 Found ${corruptedIds.length} unique corrupted cycle IDs`);
  
  return corruptedIds;
}

async function replaceDatabaseRecords(apiCycles: FulfilWorkCycle[], corruptedIds: number[]): Promise<number> {
  console.log("💾 REPLACING CORRUPTED RECORDS WITH AUTHENTIC API DATA");
  
  // Create a map of API data by cycle ID for fast lookup
  const apiDataMap = new Map<number, FulfilWorkCycle>();
  for (const cycle of apiCycles) {
    apiDataMap.set(cycle.id, cycle);
  }
  
  let replacedCount = 0;
  let notFoundCount = 0;
  
  for (const corruptedId of corruptedIds) {
    const apiData = apiDataMap.get(corruptedId);
    
    if (!apiData) {
      notFoundCount++;
      continue;
    }
    
    // Validate the API data has reasonable duration
    if (!apiData.duration || apiData.duration <= 0) {
      console.log(`⚠️  Cycle ${corruptedId}: Invalid duration ${apiData.duration}, skipping`);
      continue;
    }
    
    try {
      // Update the corrupted record with authentic API data
      await db.execute(sql`
        UPDATE work_cycles 
        SET 
          work_cycles_duration = ${apiData.duration},
          work_cycles_quantity_done = ${apiData.quantity_done || null},
          work_cycles_rec_name = ${apiData.rec_name || null},
          work_cycles_operator_rec_name = ${apiData.operator?.rec_name || null},
          work_cycles_operator_id = ${apiData.operator?.id || null},
          work_cycles_work_center_rec_name = ${apiData.work_center?.rec_name || null},
          work_operation_rec_name = ${apiData.work?.operation?.rec_name || null},
          work_operation_id = ${apiData.work?.operation?.id || null},
          work_production_id = ${apiData.work?.production?.id || null},
          work_production_number = ${apiData.work?.production?.number || null},
          work_production_quantity = ${apiData.work?.production?.quantity || null},
          work_production_product_code = ${apiData.work?.production?.product?.code || null},
          work_production_routing_rec_name = ${apiData.work?.production?.routing?.rec_name || null},
          data_corrupted = FALSE,
          updated_at = NOW()
        WHERE work_cycles_id = ${corruptedId} AND data_corrupted = TRUE
      `);
      
      replacedCount++;
      
      if (replacedCount <= 10) {
        console.log(`🔧 Replaced cycle ${corruptedId}: ${apiData.duration}s (MO: ${apiData.work?.production?.number})`);
      }
      
    } catch (error) {
      console.error(`❌ Error updating cycle ${corruptedId}:`, error);
    }
  }
  
  console.log(`✅ Successfully replaced ${replacedCount} corrupted cycles`);
  console.log(`⚠️  Not found in API: ${notFoundCount} cycles`);
  
  return replacedCount;
}

async function addNewRecentCycles(apiCycles: FulfilWorkCycle[]): Promise<number> {
  console.log("📥 ADDING NEW RECENT CYCLES FROM API");
  
  // Get the highest existing cycle ID to know what's new
  const maxIdResult = await db.execute(sql`
    SELECT COALESCE(MAX(work_cycles_id), 0) as max_id 
    FROM work_cycles
  `);
  
  const maxExistingId = maxIdResult.rows[0].max_id as number;
  console.log(`🔍 Current max cycle ID in database: ${maxExistingId}`);
  
  // Filter for cycles with ID higher than what we have
  const newCycles = apiCycles.filter(cycle => cycle.id > maxExistingId);
  console.log(`📊 Found ${newCycles.length} new cycles to add`);
  
  let addedCount = 0;
  
  for (const cycle of newCycles) {
    if (!cycle.duration || cycle.duration <= 0) {
      continue; // Skip invalid durations
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
          work_cycles_work_center_rec_name,
          work_operation_rec_name,
          work_operation_id,
          work_production_id,
          work_production_number,
          work_production_quantity,
          work_production_product_code,
          work_production_routing_rec_name,
          work_production_create_date,
          state,
          data_corrupted
        ) VALUES (
          ${cycle.id},
          ${cycle.duration},
          ${cycle.quantity_done || null},
          ${cycle.rec_name || null},
          ${cycle.operator?.rec_name || null},
          ${cycle.operator?.id || null},
          ${cycle.work_center?.rec_name || null},
          ${cycle.work?.operation?.rec_name || null},
          ${cycle.work?.operation?.id || null},
          ${cycle.work?.production?.id || null},
          ${cycle.work?.production?.number || null},
          ${cycle.work?.production?.quantity || null},
          ${cycle.work?.production?.product?.code || null},
          ${cycle.work?.production?.routing?.rec_name || null},
          ${cycle.work?.production?.create_date || null},
          'done',
          FALSE
        )
        ON CONFLICT (work_cycles_id) DO NOTHING
      `);
      
      addedCount++;
      
      if (addedCount <= 10) {
        console.log(`➕ Added new cycle ${cycle.id}: ${cycle.duration}s (${cycle.operator?.rec_name})`);
      }
      
    } catch (error) {
      console.error(`❌ Error adding cycle ${cycle.id}:`, error);
    }
  }
  
  console.log(`✅ Successfully added ${addedCount} new cycles`);
  return addedCount;
}

async function verifyDataIntegrity(): Promise<void> {
  console.log("\n📊 VERIFYING FINAL DATA INTEGRITY");
  
  const integritySummary = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(CASE WHEN data_corrupted = TRUE THEN 1 END) as still_corrupted,
      COUNT(CASE WHEN data_corrupted = FALSE OR data_corrupted IS NULL THEN 1 END) as clean_cycles,
      ROUND(AVG(work_cycles_duration), 2) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration
    FROM work_cycles 
    WHERE work_cycles_duration IS NOT NULL
  `);
  
  const stats = integritySummary.rows[0];
  console.log(`✅ Total Cycles: ${stats.total_cycles}`);
  console.log(`✅ Clean Cycles: ${stats.clean_cycles}`);
  console.log(`❌ Still Corrupted: ${stats.still_corrupted}`);
  console.log(`📈 Average Duration: ${Math.round(stats.avg_duration_seconds)}s (${Math.round(stats.avg_duration_seconds/60)}min)`);
  console.log(`📊 Duration Range: ${stats.min_duration}s - ${Math.round(stats.max_duration)}s`);
}

async function main() {
  try {
    console.log("🚀 STARTING BULK REBUILD FROM FULFIL API\n");
    
    // Step 1: Fetch bulk work cycles from API
    const apiCycles = await fetchBulkWorkCyclesFromAPI();
    
    // Step 2: Get corrupted cycle IDs
    const corruptedIds = await getCorruptedCycleIds();
    
    // Step 3: Replace corrupted records with authentic API data
    const replacedCount = await replaceDatabaseRecords(apiCycles, corruptedIds);
    
    // Step 4: Add any new recent cycles
    const addedCount = await addNewRecentCycles(apiCycles);
    
    // Step 5: Verify final data integrity
    await verifyDataIntegrity();
    
    console.log("\n🎯 BULK REBUILD SUMMARY:");
    console.log(`   API Cycles Fetched: ${apiCycles.length}`);
    console.log(`   Corrupted IDs Found: ${corruptedIds.length}`);
    console.log(`   Records Replaced: ${replacedCount}`);
    console.log(`   New Cycles Added: ${addedCount}`);
    
    console.log("\n🔄 NEXT STEPS:");
    console.log("1. Recalculate UPH with clean authentic data");
    console.log("2. Verify specific MO calculations are now realistic");
    console.log("3. Monitor system for improved data quality");
    
  } catch (error) {
    console.error("❌ Error during bulk rebuild:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchBulkWorkCyclesFromAPI, replaceDatabaseRecords, addNewRecentCycles };