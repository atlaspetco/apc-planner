import { storage } from "./storage.js";
import { db } from "./db.js";
import { workCycles, operators } from "../shared/schema.js";
import { eq } from "drizzle-orm";

const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
const FULFIL_BASE_URL = "https://apc.fulfil.io";

interface FulfilWorkCycle {
  id: number;
  operator_rec_name?: string;
  rec_name: string;
  production: any;
  work_center_category?: string;
  work_operation_rec_name?: string;
  production_work_cycles_duration?: number;
  production_work_cycles_id?: number;
  work_cycles_work_center_rec_name?: string;
  state?: string;
  production_routing_rec_name?: string;
  production_quantity?: number;
  create_date?: string;
  production_planned_date?: string;
  production_priority?: number;
  // Additional fields from work cycles
  work_cycles?: Array<{
    duration: number;
    quantity_done: number;
    operator: { rec_name: string };
    work_center: { rec_name: string };
    id: number;
  }>;
}

/**
 * Import all work cycles from Fulfil using search_read with pagination
 * Following PRD specification for canonical work-cycle pull
 */
export async function importAllWorkCyclesFromFulfil() {
  console.log("\n=== FULFIL SEARCH_READ IMPORT STARTED ===");
  
  if (!FULFIL_ACCESS_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not set");
  }

  const operatorMap = new Map<string, number>();
  let totalImported = 0;
  let offset = 0;
  const limit = 500; // As specified in PRD
  let hasMore = true;

  // Get existing operators
  const existingOperators = await db.select().from(operators);
  existingOperators.forEach(op => {
    if (op.name) operatorMap.set(op.name, op.id);
  });

  try {
    while (hasMore) {
      console.log(`Fetching work cycles with offset=${offset}, limit=${limit}...`);
      
      // Make search_read request to production.work endpoint
      const response = await fetch(`${FULFIL_BASE_URL}/api/v2/model/production.work/search_read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": FULFIL_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          filters: [
            ["state", "=", "done"]
          ],
          fields: [
            "id",
            "rec_name",
            "production",
            "production.number",
            "production.quantity",
            "production.routing.rec_name",
            "operation.rec_name",
            "work_center.rec_name",
            "work_cycles",
            "state"
          ],
          offset,
          limit,
          order: [["id", "ASC"]]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fulfil API error: ${response.status} - ${errorText}`);
      }

      const workOrders: any[] = await response.json();
      console.log(`Received ${workOrders.length} work orders`);

      if (workOrders.length === 0) {
        hasMore = false;
        break;
      }

      // Process each work order and its nested cycles
      for (const workOrder of workOrders) {
        // Get work order data
        const workId = workOrder.id;
        const workRecName = workOrder.rec_name;
        const productionId = workOrder.production;
        const productionNumber = workOrder['production.number'];
        const routing = workOrder['production.routing.rec_name'];
        const productionQuantity = workOrder['production.quantity'];
        const operationName = workOrder['operation.rec_name'];
        const workCenterName = workOrder['work_center.rec_name'];
        
        // Process nested work cycles
        if (workOrder.work_cycles && Array.isArray(workOrder.work_cycles)) {
          for (const cycle of workOrder.work_cycles) {
            const operatorName = cycle.operator?.rec_name || cycle.operator?.name || "Unknown";
            const cycleId = cycle.id;
            const quantityDone = cycle.quantity_done;
            const duration = cycle.duration;
            const createDate = cycle.create_date;
            const writeDate = cycle.write_date;
            
            // Create operator if doesn't exist
            if (operatorName && !operatorMap.has(operatorName)) {
              const [newOperator] = await db
                .insert(operators)
                .values({
                  name: operatorName,
                  isActive: true,
                  availableHours: 40,
                  schedulePercentage: 100,
                })
                .returning();
              operatorMap.set(operatorName, newOperator.id);
              console.log(`Created new operator: ${operatorName}`);
            }

            // Insert work cycle with proper API field mapping
            try {
              await db.insert(workCycles).values({
                work_cycles_id: cycleId,
                work_id: workId,
                work_cycles_duration: duration || 0,
                work_cycles_quantity_done: quantityDone || 0,
                work_cycles_operator_rec_name: operatorName || "Unknown",
                work_cycles_operator_id: operatorName ? operatorMap.get(operatorName) : null,
                work_cycles_work_center_rec_name: workCenterName || "Unknown",
                work_production_number: productionNumber,
                work_production_id: productionId,
                work_production_routing_rec_name: routing,
                work_production_quantity: productionQuantity,
                work_production_create_date: createDate ? new Date(createDate) : null,
                work_operation_rec_name: operationName,
                work_rec_name: workRecName,
                state: "done",
              });
              totalImported++;
            } catch (err: any) {
              // Skip duplicates
              if (err?.message?.includes("duplicate key")) {
                continue;
              }
              console.error(`Error inserting cycle ${cycleId}:`, err);
            }
          }
        }
      }

      offset += limit;
      
      // Update import status
      (global as any).updateImportStatus?.({
        isImporting: true,
        currentOperation: `Imported ${totalImported} work cycles...`,
        progress: totalImported,
      });

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Import complete: ${totalImported} work cycles imported`);
    console.log(`Total operators: ${operatorMap.size}`);
    console.log("=== FULFIL SEARCH_READ IMPORT COMPLETE ===\n");

    return {
      success: true,
      totalImported,
      operatorCount: operatorMap.size,
    };

  } catch (error) {
    console.error("Import error:", error);
    throw error;
  }
}