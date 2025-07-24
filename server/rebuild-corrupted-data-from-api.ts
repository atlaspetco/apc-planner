import { sql } from "drizzle-orm";
import { db } from './db.js';
import { workCycles } from '../shared/schema.js';

/**
 * CRITICAL: Rebuild Corrupted Work Cycles Data from Fulfil API
 * 
 * Problem: ~9,734 work cycles have corrupted identical short durations from CSV import
 * Solution: Fetch authentic work cycle data from Fulfil API to replace corrupted records
 * 
 * Strategy:
 * 1. Get list of all corrupted work cycle IDs
 * 2. Fetch authentic data for these cycles from Fulfil API
 * 3. Update database with real durations and cycle information
 * 4. Verify data integrity after rebuild
 */

interface CorruptedCycleInfo {
  work_cycles_id: number;
  work_production_number: string;
  work_cycles_operator_rec_name: string;
  current_duration: number;
}

async function getCorruptedCyclesList(): Promise<CorruptedCycleInfo[]> {
  console.log("🔍 IDENTIFYING CORRUPTED WORK CYCLES FOR API REBUILD");
  
  const corruptedCycles = await db.execute(sql`
    SELECT 
      work_cycles_id,
      work_production_number,
      work_cycles_operator_rec_name,
      work_cycles_duration as current_duration
    FROM work_cycles 
    WHERE data_corrupted = TRUE
    ORDER BY work_cycles_id
  `);

  console.log(`📊 Found ${corruptedCycles.rows.length} corrupted cycles requiring API rebuild`);
  
  return corruptedCycles.rows as CorruptedCycleInfo[];
}

async function fetchAuthenticCycleFromAPI(cycleId: number): Promise<any> {
  const FULFIL_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  if (!FULFIL_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not found in environment");
  }

  const url = `https://apc.fulfil.io/api/v2/model/production.work.cycles/${cycleId}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': FULFIL_TOKEN
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`⚠️  Cycle ${cycleId} not found in Fulfil API (may be deleted)`);
        return null;
      }
      throw new Error(`API Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`❌ Error fetching cycle ${cycleId}:`, error);
    return null;
  }
}

async function batchFetchCyclesFromAPI(cycleIds: number[], batchSize = 10): Promise<Map<number, any>> {
  console.log(`🔄 FETCHING ${cycleIds.length} CYCLES FROM FULFIL API (batches of ${batchSize})`);
  
  const cycleDataMap = new Map<number, any>();
  let fetchedCount = 0;
  let notFoundCount = 0;
  
  for (let i = 0; i < cycleIds.length; i += batchSize) {
    const batch = cycleIds.slice(i, i + batchSize);
    
    console.log(`📡 Fetching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(cycleIds.length/batchSize)} (cycles ${batch[0]} - ${batch[batch.length-1]})`);
    
    // Process batch with small delay to respect API limits
    const batchPromises = batch.map(async (cycleId, index) => {
      // Stagger requests slightly
      await new Promise(resolve => setTimeout(resolve, index * 100));
      const data = await fetchAuthenticCycleFromAPI(cycleId);
      
      if (data) {
        cycleDataMap.set(cycleId, data);
        fetchedCount++;
      } else {
        notFoundCount++;
      }
    });
    
    await Promise.all(batchPromises);
    
    // Delay between batches
    if (i + batchSize < cycleIds.length) {
      console.log(`⏳ Waiting 1 second before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`✅ Fetched: ${fetchedCount}, Not Found: ${notFoundCount}, Total: ${cycleIds.length}`);
  return cycleDataMap;
}

async function updateDatabaseWithAuthenticData(cycleDataMap: Map<number, any>): Promise<number> {
  console.log("💾 UPDATING DATABASE WITH AUTHENTIC CYCLE DATA");
  
  let updatedCount = 0;
  
  for (const [cycleId, apiData] of cycleDataMap) {
    try {
      // Extract authentic duration and other fields from API response
      const authenticDuration = apiData.duration || apiData.work_cycles_duration;
      const authenticQuantity = apiData.quantity_done || apiData.work_cycles_quantity_done;
      
      if (!authenticDuration || authenticDuration <= 0) {
        console.log(`⚠️  Cycle ${cycleId}: Invalid duration ${authenticDuration}, keeping as corrupted`);
        continue;
      }
      
      // Update the record with authentic data and mark as clean
      await db.execute(sql`
        UPDATE work_cycles 
        SET 
          work_cycles_duration = ${authenticDuration},
          work_cycles_quantity_done = ${authenticQuantity || null},
          data_corrupted = FALSE,
          updated_at = NOW()
        WHERE work_cycles_id = ${cycleId}
      `);
      
      updatedCount++;
      
      if (updatedCount <= 5) {
        console.log(`🔧 Updated cycle ${cycleId}: ${authenticDuration}s (was corrupted)`);
      }
      
    } catch (error) {
      console.error(`❌ Error updating cycle ${cycleId}:`, error);
    }
  }
  
  console.log(`✅ Successfully updated ${updatedCount} cycles with authentic data`);
  return updatedCount;
}

async function verifyDataIntegrityAfterRebuild(): Promise<void> {
  console.log("\n📊 VERIFYING DATA INTEGRITY AFTER REBUILD");
  
  const integritySummary = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(CASE WHEN data_corrupted = TRUE THEN 1 END) as still_corrupted,
      COUNT(CASE WHEN data_corrupted = FALSE OR data_corrupted IS NULL THEN 1 END) as clean_cycles,
      AVG(work_cycles_duration) as avg_duration_seconds,
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
    console.log("🚀 STARTING CORRUPTED DATA REBUILD FROM FULFIL API\n");
    
    // Step 1: Get list of corrupted cycles
    const corruptedCycles = await getCorruptedCyclesList();
    
    if (corruptedCycles.length === 0) {
      console.log("✅ No corrupted cycles found - data is already clean");
      return;
    }
    
    // Step 2: Extract unique cycle IDs for API fetching
    const cycleIds = [...new Set(corruptedCycles.map(c => c.work_cycles_id))].filter(id => id);
    console.log(`🎯 Will fetch ${cycleIds.length} unique cycle IDs from Fulfil API`);
    
    // Step 3: Batch fetch authentic data from API
    const cycleDataMap = await batchFetchCyclesFromAPI(cycleIds, 5); // Smaller batches for reliability
    
    // Step 4: Update database with authentic data
    const updatedCount = await updateDatabaseWithAuthenticData(cycleDataMap);
    
    // Step 5: Verify data integrity
    await verifyDataIntegrityAfterRebuild();
    
    console.log("\n🎯 REBUILD SUMMARY:");
    console.log(`   Corrupted Cycles Identified: ${corruptedCycles.length}`);
    console.log(`   Unique Cycle IDs: ${cycleIds.length}`);
    console.log(`   Successfully Fetched: ${cycleDataMap.size}`);
    console.log(`   Database Records Updated: ${updatedCount}`);
    
    console.log("\n🔄 NEXT STEPS:");
    console.log("1. Recalculate UPH with rebuilt authentic data");
    console.log("2. Verify specific MO calculations (like MO94699)");
    console.log("3. Monitor for any remaining data quality issues");
    
  } catch (error) {
    console.error("❌ Error during data rebuild:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { getCorruptedCyclesList, batchFetchCyclesFromAPI, updateDatabaseWithAuthenticData };