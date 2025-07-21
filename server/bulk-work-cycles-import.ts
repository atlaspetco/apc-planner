import { db } from "./db.js";
import { workCycles, operators } from "../shared/schema.js";
import { eq } from "drizzle-orm";

const FULFIL_BASE_URL = "https://apc.fulfil.io";
const BATCH_SIZE = 500; // Larger batch size for efficiency
const RATE_LIMIT_DELAY = 500; // 500ms between requests

interface WorkCycleResponse {
  id: number;
  work_cycles_id: string;
  work_cycles_operator_rec_name: string;
  work_operation_rec_name: string;
  work_cycles_work_center_rec_name: string;
  work_cycles_duration: number;
  work_cycles_quantity: number;
  work_production_rec_name: string;
  work_production_routing_rec_name: string;
  work_production_id: number;
  work_cycles_effective_date: string;
  state: string;
}

export async function bulkImportAllWorkCycles() {
  if (!process.env.FULFIL_ACCESS_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not configured");
  }

  console.log("Starting comprehensive work cycles import...");
  
  let totalImported = 0;
  let totalSkipped = 0;
  let offset = 0;
  let hasMore = true;
  let highestId = 0;
  
  // Get the highest work cycle ID we have
  const existingCycles = await db.select({ 
    work_cycles_id: workCycles.work_cycles_id 
  }).from(workCycles);
  
  const existingIds = new Set(existingCycles.map(c => c.work_cycles_id));
  console.log(`Found ${existingIds.size} existing work cycles in database`);

  // Map to track unique operators
  const uniqueOperators = new Map<string, { name: string, workCenters: Set<string> }>();

  while (hasMore) {
    try {
      // Update progress
      if (global.updateImportStatus) {
        global.updateImportStatus({
          isImporting: true,
          currentOperation: `Importing work cycles batch (offset: ${offset})`,
          progress: Math.min((totalImported / 245885) * 100, 99),
          startTime: Date.now()
        });
      }

      // Fetch batch from Fulfil
      const response = await fetch(`${FULFIL_BASE_URL}/api/v2/model/production.work.cycles/search_read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.FULFIL_ACCESS_TOKEN
        },
        body: JSON.stringify({
          filters: [["state", "=", "done"]],
          fields: [
            "id",
            "work/cycles/id",
            "work/cycles/operator/rec_name",
            "work/operation/rec_name",
            "work/cycles/work_center/rec_name",
            "work/cycles/duration",
            "work/cycles/quantity",
            "work/production/rec_name",
            "work/production/routing/rec_name",
            "work/production/id",
            "work/cycles/effective_date"
          ],
          order: [["id", "ASC"]],
          limit: BATCH_SIZE,
          offset: offset
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as WorkCycleResponse[];
      
      if (data.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Processing batch at offset ${offset} with ${data.length} records...`);

      // Process batch
      for (const cycle of data) {
        const workCyclesId = cycle.work_cycles_id?.toString();
        
        if (!workCyclesId || existingIds.has(workCyclesId)) {
          totalSkipped++;
          continue;
        }

        // Track highest ID for reporting
        if (cycle.id > highestId) {
          highestId = cycle.id;
        }

        // Extract data with proper null handling
        const operatorName = cycle.work_cycles_operator_rec_name || null;
        const workCenter = cycle.work_cycles_work_center_rec_name || null;
        
        // Track unique operators
        if (operatorName && workCenter) {
          if (!uniqueOperators.has(operatorName)) {
            uniqueOperators.set(operatorName, { 
              name: operatorName, 
              workCenters: new Set() 
            });
          }
          uniqueOperators.get(operatorName)!.workCenters.add(workCenter);
        }

        // Extract operation from rec_name
        let operation = null;
        if (cycle.work_operation_rec_name) {
          const parts = cycle.work_operation_rec_name.split(' | ');
          if (parts.length >= 2) {
            operation = parts[0];
          }
        }

        // Insert work cycle
        try {
          await db.insert(workCycles).values({
            workCyclesId,
            workCyclesOperatorRecName: operatorName,
            workOperationRecName: cycle.work_operation_rec_name || null,
            workCyclesWorkCenterRecName: workCenter,
            workCyclesDuration: cycle.work_cycles_duration || 0,
            workCyclesQuantity: cycle.work_cycles_quantity || 0,
            workProductionRecName: cycle.work_production_rec_name || null,
            workProductionRoutingRecName: cycle.work_production_routing_rec_name || null,
            workProductionId: cycle.work_production_id?.toString() || null,
            workCyclesEffectiveDate: cycle.work_cycles_effective_date || null
          });
          
          totalImported++;
          existingIds.add(workCyclesId);
        } catch (error) {
          console.error(`Failed to insert work cycle ${workCyclesId}:`, error);
        }
      }

      // Check if we have more data
      if (data.length < BATCH_SIZE) {
        hasMore = false;
      } else {
        offset += BATCH_SIZE;
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      // Log progress every 10 batches
      if (offset % (BATCH_SIZE * 10) === 0) {
        console.log(`Progress: Imported ${totalImported} cycles, skipped ${totalSkipped}, highest ID: ${highestId}`);
      }

    } catch (error) {
      console.error(`Error at offset ${offset}:`, error);
      // Continue with next batch instead of failing completely
      offset += BATCH_SIZE;
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * 2));
    }
  }

  // Create missing operators
  console.log("\nCreating missing operators...");
  let newOperatorsCreated = 0;
  
  for (const [operatorName, data] of uniqueOperators) {
    const existing = await db.select().from(operators).where(eq(operators.name, operatorName));
    
    if (existing.length === 0) {
      await db.insert(operators).values({
        name: operatorName,
        isActive: true,
        workCenters: Array.from(data.workCenters),
        operations: [],
        routings: [],
        availableHours: 40,
        lastActiveDate: new Date().toISOString()
      });
      newOperatorsCreated++;
      console.log(`Created operator: ${operatorName}`);
    }
  }

  // Clear import status
  if (global.updateImportStatus) {
    global.updateImportStatus({
      isImporting: false,
      currentOperation: 'Bulk import completed',
      progress: 100,
      startTime: null
    });
  }

  console.log("\n=== Bulk Import Complete ===");
  console.log(`Total work cycles imported: ${totalImported}`);
  console.log(`Total work cycles skipped: ${totalSkipped}`);
  console.log(`Highest work cycle ID: ${highestId}`);
  console.log(`New operators created: ${newOperatorsCreated}`);
  console.log(`Total unique operators found: ${uniqueOperators.size}`);

  return {
    totalImported,
    totalSkipped,
    highestId,
    newOperatorsCreated,
    uniqueOperatorsCount: uniqueOperators.size
  };
}

// Function to import in chunks with progress tracking
export async function importWorkCyclesInChunks(targetCount: number = 50000) {
  const results = {
    totalImported: 0,
    totalSkipped: 0,
    batches: 0,
    errors: [] as string[]
  };

  try {
    // Import until we reach target count
    while (results.totalImported < targetCount) {
      const batchResult = await bulkImportAllWorkCycles();
      results.totalImported += batchResult.totalImported;
      results.totalSkipped += batchResult.totalSkipped;
      results.batches++;
      
      if (batchResult.totalImported === 0) {
        console.log("No more new work cycles to import");
        break;
      }
      
      // Small delay between major batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    results.errors.push(error instanceof Error ? error.message : "Unknown error");
  }

  return results;
}