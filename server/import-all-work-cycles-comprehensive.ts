import { db } from "./db";
import { workCycles } from "../shared/schema";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

interface FulfilWorkCycle {
  id: number;
  rec_name: string;
  operator_rec_name?: string;
  production?: number;
  work_center_category?: string;
  work_operation_rec_name?: string;
  production_work_cycles_duration?: number;
  work_cycles_work_center_rec_name?: string;
  state?: string;
  production_routing_rec_name?: string;
  production_quantity?: number;
  create_date?: string;
  production_planned_date?: string;
  production_work_cycles_id?: number[];
}

async function fetchAllWorkCyclesFromAPI(): Promise<FulfilWorkCycle[]> {
  const FULFIL_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  if (!FULFIL_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not found in environment");
  }

  console.log("🔄 FETCHING ALL WORK CYCLES FROM FULFIL API");
  
  const allCycles: FulfilWorkCycle[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 2000; // Larger batch size for efficiency
  
  while (hasMore) {
    const url = 'https://apc.fulfil.io/api/v2/model/production.work/search_read';
    
    const requestBody = {
      "filters": [
        ['state', 'in', ['done', 'finished']]
      ],
      "fields": [
        'id',
        'operator_rec_name',
        'rec_name',
        'production',
        'work_center_category',
        'work_operation_rec_name',
        'production_work_cycles_duration',
        'work_cycles_work_center_rec_name',
        'state',
        'production_routing_rec_name',
        'production_quantity',
        'create_date',
        'production_planned_date',
        'production_work_cycles_id'
      ],
      "limit": limit,
      "offset": offset
    };

    try {
      console.log(`📥 Fetching batch: offset=${offset}, limit=${limit}`);
      
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
      
      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
        console.log("✅ No more data to fetch");
        break;
      }
      
      allCycles.push(...data);
      console.log(`📊 Fetched ${data.length} work cycles (total: ${allCycles.length})`);
      
      // Check if we got less than the limit, indicating we've reached the end
      if (data.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.error(`❌ Error fetching batch at offset ${offset}:`, error);
      throw error;
    }
  }
  
  console.log(`✅ Total work cycles fetched: ${allCycles.length}`);
  return allCycles;
}

function parseDuration(durationSeconds: number | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) {
    return 0;
  }
  return Math.round(durationSeconds);
}

function extractMONumber(recName: string | undefined): string | null {
  if (!recName) return null;
  
  // Format: "WO33046 | Sewing | MO178231"
  const parts = recName.split('|');
  if (parts.length >= 3) {
    const moPart = parts[2].trim();
    if (moPart.startsWith('MO')) {
      return moPart;
    }
  }
  return null;
}

function extractWorkCenter(recName: string | undefined): string | null {
  if (!recName) return null;
  
  // Format: "WO33046 | Sewing | MO178231"
  const parts = recName.split('|');
  if (parts.length >= 2) {
    return parts[1].trim();
  }
  return null;
}

async function importAllWorkCycles(): Promise<void> {
  try {
    console.log("🚀 STARTING COMPREHENSIVE WORK CYCLES IMPORT");
    
    // Fetch all work cycles from API
    const cycles = await fetchAllWorkCyclesFromAPI();
    
    if (cycles.length === 0) {
      console.log("⚠️  No work cycles found to import");
      return;
    }
    
    // Clear existing work cycles
    console.log("🗑️  Clearing existing work cycles...");
    await db.delete(workCycles);
    
    // Process and insert cycles in batches
    const batchSize = 500;
    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;
    
    for (let i = 0; i < cycles.length; i += batchSize) {
      const batch = cycles.slice(i, i + batchSize);
      const insertData = [];
      
      for (const cycle of batch) {
        try {
          // Extract work cycle ID from production_work_cycles_id array
          const workCycleId = cycle.production_work_cycles_id?.[0] || cycle.id;
          
          // Skip if no operator
          if (!cycle.operator_rec_name) {
            skipCount++;
            continue;
          }
          
          // Parse duration
          const durationSeconds = parseDuration(cycle.production_work_cycles_duration);
          if (durationSeconds <= 0) {
            skipCount++;
            continue;
          }
          
          // Extract MO number and work center from rec_name
          const moNumber = extractMONumber(cycle.rec_name);
          const workCenter = extractWorkCenter(cycle.rec_name) || cycle.work_cycles_work_center_rec_name || 'Unknown';
          
          insertData.push({
            work_cycles_id: workCycleId,
            work_cycles_duration: durationSeconds,
            work_cycles_rec_name: cycle.rec_name || '',
            work_cycles_operator_rec_name: cycle.operator_rec_name,
            work_cycles_operator_id: null, // We don't have operator ID in this response
            work_cycles_work_center_rec_name: workCenter,
            work_cycles_quantity_done: cycle.production_quantity || 0,
            work_production_id: cycle.production || null,
            work_production_number: moNumber,
            work_production_quantity: cycle.production_quantity || null,
            work_production_routing_rec_name: cycle.production_routing_rec_name || null,
            work_operation_rec_name: cycle.work_operation_rec_name || null,
            state: cycle.state || null,
            work_production_create_date: cycle.create_date || null,
            data_corrupted: false // New data is not corrupted
          });
          
        } catch (error) {
          console.error(`Error processing cycle ${cycle.id}:`, error);
          errorCount++;
        }
      }
      
      // Insert batch
      if (insertData.length > 0) {
        try {
          await db.insert(workCycles).values(insertData);
          successCount += insertData.length;
          console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}: ${insertData.length} cycles (total: ${successCount})`);
        } catch (error) {
          console.error(`Error inserting batch:`, error);
          errorCount += insertData.length;
        }
      }
    }
    
    // Get final statistics
    const finalCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    const stats = await db.select({
      operators: sql<number>`count(distinct work_cycles_operator_rec_name)`,
      workCenters: sql<number>`count(distinct work_cycles_work_center_rec_name)`,
      routings: sql<number>`count(distinct work_production_routing_rec_name)`,
      minDate: sql<string>`min(created_at)`,
      maxDate: sql<string>`max(created_at)`
    }).from(workCycles);
    
    console.log('\n=== IMPORT COMPLETE ===');
    console.log(`✅ Successfully imported: ${successCount} work cycles`);
    console.log(`⚠️  Skipped: ${skipCount} cycles (no operator or invalid duration)`);
    console.log(`❌ Errors: ${errorCount} cycles`);
    console.log(`📊 Total in database: ${finalCount[0].count}`);
    console.log('\n=== DATA STATISTICS ===');
    console.log(`👷 Unique operators: ${stats[0].operators}`);
    console.log(`🏭 Unique work centers: ${stats[0].workCenters}`);
    console.log(`📋 Unique routings: ${stats[0].routings}`);
    console.log(`📅 Date range: ${stats[0].minDate} to ${stats[0].maxDate}`);
    
  } catch (error) {
    console.error('❌ Fatal error during import:', error);
    throw error;
  }
}

// Run the import if called directly
if (require.main === module) {
  importAllWorkCycles()
    .then(() => {
      console.log('✨ Import completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Import failed:', error);
      process.exit(1);
    });
}

export { importAllWorkCycles };