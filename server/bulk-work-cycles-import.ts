import { db } from "./db.js";
import { workCycles, operators } from "../shared/schema.js";
import { eq } from "drizzle-orm";

const FULFIL_BASE_URL = "https://apc.fulfil.io";
const BATCH_SIZE = 500; // Larger batch size for efficiency
const RATE_LIMIT_DELAY = 500; // 500ms between requests

interface WorkCycleResponse {
  id: number;
  operator_rec_name: string;
  rec_name: string;
  production: number;
  work_center_category: string;
  work_operation_rec_name: string;
  production_work_cycles_duration: number;
  production_work_cycles_id: string;
  work_cycles_work_center_rec_name: string;
  state: string;
  production_routing_rec_name: string;
  production_quantity: number;
  create_date: string;
  production_planned_date: string;
  production_priority: string;
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
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  
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
      if ((global as any).updateImportStatus) {
        (global as any).updateImportStatus({
          isImporting: true,
          currentOperation: `Importing work cycles batch (offset: ${offset})`,
          processedItems: totalImported,
          totalItems: 32894, // Expected total from CSV
          startTime: Date.now()
        });
      }

      // Fetch batch from Fulfil
      const response = await fetch(`${FULFIL_BASE_URL}/api/v2/model/production.work/search_read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.FULFIL_ACCESS_TOKEN
        },
        body: JSON.stringify({
          filters: [["state", "in", ["done", "finished"]]],
          fields: [
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
          order: [["create_date", "ASC"]],
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
        const workCyclesId = cycle.production_work_cycles_id?.toString();
        
        if (!workCyclesId || existingIds.has(workCyclesId)) {
          totalSkipped++;
          continue;
        }

        // Track highest ID for reporting
        if (cycle.id > highestId) {
          highestId = cycle.id;
        }

        // Extract data with proper null handling
        const operatorName = cycle.operator_rec_name || null;
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

        // Extract production number from rec_name (format: "WO33046 | Sewing | MO178231")
        let productionNumber = null;
        if (cycle.rec_name) {
          const parts = cycle.rec_name.split(' | ');
          if (parts.length >= 3) {
            productionNumber = parts[2]; // MO number
          }
        }

        // Insert work cycle
        try {
          await db.insert(workCycles).values({
            work_cycles_id: workCyclesId,
            work_cycles_operator_rec_name: operatorName,
            work_operation_rec_name: cycle.work_operation_rec_name || null,
            work_cycles_work_center_rec_name: workCenter,
            work_cycles_duration: cycle.production_work_cycles_duration || 0,
            work_cycles_quantity: cycle.production_quantity || 0,
            work_production_rec_name: productionNumber,
            work_production_routing_rec_name: cycle.production_routing_rec_name || null,
            work_production_id: cycle.production?.toString() || null,
            work_cycles_effective_date: cycle.production_planned_date || null,
            state: cycle.state || null
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

      // Reset consecutive errors on success
      consecutiveErrors = 0;

    } catch (error) {
      console.error(`Error at offset ${offset}:`, error);
      consecutiveErrors++;
      
      // Stop import after too many consecutive errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`Stopping import after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        hasMore = false;
        
        // Update status to show error
        if ((global as any).updateImportStatus) {
          (global as any).updateImportStatus({
            isImporting: false,
            lastError: `Import stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors at offset ${offset}`,
            currentOperation: 'Import failed'
          });
        }
        break;
      }
      
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
  if ((global as any).updateImportStatus) {
    (global as any).updateImportStatus({
      isImporting: false,
      currentOperation: 'Bulk import completed',
      processedItems: totalImported,
      totalItems: totalImported + totalSkipped,
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