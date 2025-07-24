import { FulfilAPIService } from "./fulfil-api.js";
import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";

interface CanonicalWorkCycle {
  id: number;
  operator_rec_name: string;
  rec_name: string;
  production: number;
  work_center_category: string;
  work_operation_rec_name: string;
  production_work_cycles_duration: number;
  production_work_cycles_id: number;
  work_cycles_work_center_rec_name: string;
  state: string;
  production_routing_rec_name: string;
  production_quantity: number;
  create_date: string;
  production_planned_date: string;
  production_priority: string;
}

/**
 * Canonical Work-Cycle Pull as specified in PRD Section 4.1
 * Uses PUT /api/v2/model/production.work/search_read with exact field specification
 */
export async function canonicalWorkCyclePull(
  limit: number = 500,
  offset: number = 0
): Promise<{
  success: boolean;
  imported: number;
  totalRecords: number;
  message: string;
}> {
  console.log(`🔄 Starting canonical work cycle pull (offset: ${offset}, limit: ${limit})`);
  
  try {
    // Exact API call as specified in PRD
    const requestBody = {
      "filters": [["state", "=", ["done", "finished"]]],
      "fields": [
        "id",
        "operator_rec_name",
        "rec_name", 
        "production",
        "work_center_category",
        "work_operation_rec_name",
        "production_work_cycles_duration",
        "production_work_cycles_id",
        "work_cycles_work_center_rec_name",
        "state",
        "production_routing_rec_name",
        "production_quantity",
        "create_date",
        "production_planned_date",
        "production_priority"
      ],
      "offset": offset,
      "limit": limit,
      "order": [["create_date", "ASC"]]
    };

    console.log('Making PUT request to /api/v2/model/production.work/search_read');
    
    const fulfilService = new FulfilAPIService();
    if (!process.env.FULFIL_ACCESS_TOKEN) {
      throw new Error('FULFIL_ACCESS_TOKEN not configured');
    }
    fulfilService.setApiKey(process.env.FULFIL_ACCESS_TOKEN);
    
    const response = await fulfilService.makeRequest('PUT', '/api/v2/model/production.work/search_read', requestBody);
    
    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response format from Fulfil API');
    }

    const workCycleData: CanonicalWorkCycle[] = response.data;
    console.log(`📥 Received ${workCycleData.length} work cycles from Fulfil`);

    if (workCycleData.length === 0) {
      return {
        success: true,
        imported: 0,
        totalRecords: 0,
        message: "No more work cycles to import"
      };
    }

    // Transform and insert into database with exact field mapping
    let imported = 0;
    const batchSize = 100;
    
    for (let i = 0; i < workCycleData.length; i += batchSize) {
      const batch = workCycleData.slice(i, i + batchSize);
      
      const insertData = batch.map(cycle => ({
        work_cycles_id: cycle.production_work_cycles_id?.toString() || cycle.id.toString(),
        work_id: cycle.id,
        work_production_number: extractMONumber(cycle.rec_name),
        work_cycles_operator_rec_name: cycle.operator_rec_name || 'Unknown',
        work_cycles_work_center_rec_name: cycle.work_cycles_work_center_rec_name || cycle.work_center_category || 'Unknown',
        work_production_routing_rec_name: cycle.production_routing_rec_name || 'Unknown',
        work_operation_rec_name: cycle.work_operation_rec_name || 'Unknown',
        work_cycles_duration: cycle.production_work_cycles_duration || 0,
        work_cycles_quantity_done: 1, // Default for completed cycles
        work_production_quantity: cycle.production_quantity || null,
        work_production_create_date: new Date(cycle.create_date),
        fulfilWorkId: cycle.id,
        fulfilProductionId: cycle.production,
        state: cycle.state
      }));

      // Use INSERT OR REPLACE to handle duplicates
      for (const record of insertData) {
        try {
          await db.insert(workCycles).values(record).onConflictDoUpdate({
            target: workCycles.work_cycles_id,
            set: {
              work_cycles_operator_rec_name: record.work_cycles_operator_rec_name,
              work_cycles_work_center_rec_name: record.work_cycles_work_center_rec_name,
              work_production_routing_rec_name: record.work_production_routing_rec_name,
              work_operation_rec_name: record.work_operation_rec_name,
              work_cycles_duration: record.work_cycles_duration,
              work_production_quantity: record.work_production_quantity,
              work_production_create_date: record.work_production_create_date,
              state: record.state
            }
          });
          imported++;
        } catch (error) {
          console.warn(`Failed to insert work cycle ${record.work_cycles_id}:`, error);
        }
      }
    }

    console.log(`✅ Successfully imported ${imported} work cycles`);
    
    return {
      success: true,
      imported,
      totalRecords: workCycleData.length,
      message: `Imported ${imported} work cycles using canonical API endpoint`
    };

  } catch (error) {
    console.error('Error in canonical work cycle pull:', error);
    return {
      success: false,
      imported: 0,
      totalRecords: 0,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Extract MO number from rec_name field
 * Example: "WO33046 | Sewing | MO178231" -> "MO178231"
 */
function extractMONumber(rec_name: string): string {
  if (!rec_name) return 'Unknown';
  
  const moMatch = rec_name.match(/MO\d+/);
  return moMatch ? moMatch[0] : 'Unknown';
}

/**
 * Full pagination import - loops until all data is fetched
 * This implements the "loop until empty" requirement from PRD
 */
export async function fullCanonicalImport(): Promise<{
  success: boolean;
  totalImported: number;
  message: string;
}> {
  console.log('🚀 Starting FULL canonical work cycle import with pagination');
  
  let totalImported = 0;
  let offset = 0;
  const limit = 500; // PRD specified limit
  let hasMoreData = true;

  while (hasMoreData) {
    const result = await canonicalWorkCyclePull(limit, offset);
    
    if (!result.success) {
      return {
        success: false,
        totalImported,
        message: `Import failed at offset ${offset}: ${result.message}`
      };
    }

    totalImported += result.imported;
    
    // If we got less than the limit, we've reached the end
    if (result.totalRecords < limit) {
      hasMoreData = false;
      console.log('📍 Reached end of data - import complete');
    } else {
      offset += limit;
      console.log(`⏭️  Continuing to next page (offset: ${offset})`);
      
      // Small delay to respect API rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    success: true,
    totalImported,
    message: `Successfully imported ${totalImported} work cycles using canonical API with pagination`
  };
}