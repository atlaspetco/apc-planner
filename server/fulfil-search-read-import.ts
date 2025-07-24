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
      
      // Make search_read request as specified in PRD
      const response = await fetch(`${FULFIL_BASE_URL}/api/v2/model/production.work.cycles/search_read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": FULFIL_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          filters: [["state", "=", "done"]],
          fields: [
            "id",
            "work.id",
            "work.production.id",
            "work.production.number",
            "work.production.routing.rec_name",
            "work.production.quantity",
            "work.operation.rec_name",
            "work.work_center.rec_name",
            "operator.rec_name",
            "quantity_done",
            "duration",
            "create_date",
            "write_date"
          ],
          offset,
          limit,
          order: [["create_date", "ASC"]]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fulfil API error: ${response.status} - ${errorText}`);
      }

      const workOrders: FulfilWorkCycle[] = await response.json();
      console.log(`Received ${workOrders.length} work orders`);

      if (workOrders.length === 0) {
        hasMore = false;
        break;
      }

      // Process each work order and its cycles
      for (const wo of workOrders) {
        // Extract work cycles from the work order
        if (wo.work_cycles && Array.isArray(wo.work_cycles)) {
          for (const cycle of wo.work_cycles) {
            const operatorName = cycle.operator?.rec_name;
            
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

            // Parse fields from nested objects
            const productionNumber = wo.production?.number || wo.production?.rec_name?.match(/MO\d+/)?.[0];
            const routing = wo.production?.routing?.rec_name;
            const productCode = wo.production?.product?.code;
            const workCenterName = cycle.work_center?.rec_name || wo.work_center?.rec_name;
            const operationName = wo.operation?.rec_name || wo.work_operation?.rec_name;

            // Insert work cycle
            try {
              await db.insert(workCycles).values({
                work_cycles_id: cycle.id,
                work_id: wo.id,
                work_cycles_duration: cycle.duration || 0,
                work_cycles_quantity_done: cycle.quantity_done || 0,
                work_cycles_operator_rec_name: operatorName || "Unknown",
                work_cycles_operator_id: operatorName ? operatorMap.get(operatorName) : null,
                work_cycles_work_center_rec_name: workCenterName || "Unknown",
                work_production_number: productionNumber,
                work_production_id: wo.production?.id,
                work_production_routing_rec_name: routing,
                work_production_product_code: productCode,
                work_production_quantity: wo.production?.quantity,
                work_production_create_date: wo.production?.create_date ? new Date(wo.production.create_date) : null,
                work_rec_name: wo.rec_name,
                work_operation_rec_name: operationName,
                work_operation_id: wo.operation?.id,
                work_cycles_rec_name: `${wo.rec_name} | ${operatorName} | ${workCenterName}`,
              });
              totalImported++;
            } catch (err) {
              // Skip duplicates
              if (err?.message?.includes("duplicate key")) {
                continue;
              }
              console.error(`Error inserting cycle ${cycle.id}:`, err);
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