import { FulfilAPIService } from "./fulfil-api.js";
import { db } from "./db.js";
import { productionOrders, workOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Import recent production orders from Fulfil API
 */
export async function importRecentProductionOrders(
  limit: number = 2500,
  state: string = "done",
  progressCallback?: ProgressCallback
): Promise<{
  productionOrdersImported: number;
  workOrdersImported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting import of ${limit} recent ${state} production orders from Fulfil...`);
  
  const fulfil = new FulfilAPIService();
  let productionOrdersImported = 0;
  let workOrdersImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  try {
    // Test connection first
    const connectionTest = await fulfil.testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Fulfil API connection failed: ${connectionTest.message}`);
    }
    
    progressCallback?.(0, limit, "Fetching production orders from Fulfil...");
    
    // Fetch production orders with specific state
    const productionOrdersData = await fulfil.fetchProductionOrders(limit, state);
    
    if (!productionOrdersData || productionOrdersData.length === 0) {
      console.log(`No ${state} production orders found in Fulfil`);
      return { productionOrdersImported: 0, workOrdersImported: 0, skipped: 0, errors: [] };
    }
    
    console.log(`Retrieved ${productionOrdersData.length} production orders from Fulfil`);
    
    // Process production orders in batches
    const batchSize = 50;
    for (let i = 0; i < productionOrdersData.length; i += batchSize) {
      const batch = productionOrdersData.slice(i, Math.min(i + batchSize, productionOrdersData.length));
      
      for (const poData of batch) {
        try {
          // Check if production order already exists
          const existingPO = await db.select({ id: productionOrders.id })
            .from(productionOrders)
            .where(eq(productionOrders.fulfilId, poData.id))
            .limit(1);
          
          if (existingPO.length > 0) {
            skipped++;
            continue;
          }
          
          // Parse product code and routing
          const productCode = poData['product.code'] || poData.product?.code || null;
          const routingName = poData['routing.name'] || poData.routing?.name || null;
          
          // Parse planned date
          let plannedDate = null;
          if (poData.planned_date) {
            if (typeof poData.planned_date === 'string') {
              plannedDate = poData.planned_date;
            } else if (poData.planned_date && 'iso_string' in poData.planned_date) {
              plannedDate = poData.planned_date.iso_string;
            }
          }
          
          // Insert production order
          const [newPO] = await db.insert(productionOrders).values({
            moNumber: poData.rec_name,
            productName: productCode ? `Product ${productCode}` : `Product ${poData.id}`,
            quantity: poData.quantity || 0,
            status: poData.state.toLowerCase(),
            routing: routingName,
            dueDate: plannedDate,
            priority: "Medium",
            fulfilId: poData.id,
            rec_name: poData.rec_name,
            product_code: productCode,
            routingName: routingName,
            planned_date: plannedDate
          }).returning({ id: productionOrders.id });
          
          productionOrdersImported++;
          
          // Fetch and create work orders for this production order
          try {
            const workOrdersData = await fulfil.fetchWorkOrders({ production: poData.id });
            
            for (const woData of workOrdersData) {
              await db.insert(workOrders).values({
                workOrderNumber: woData.rec_name,
                productionOrderId: newPO.id,
                operation: woData['operation.name'] || "Manufacturing",
                workCenter: woData['work_center.name'] || "General",
                status: woData.state.toLowerCase(),
                assignedOperatorId: null,
                estimatedHours: null,
                actualHours: null,
                quantity: woData.quantity_done || 0,
                routing: routingName,
                fulfilId: woData.id,
                rec_name: woData.rec_name
              });
              
              workOrdersImported++;
            }
          } catch (woError) {
            console.warn(`Failed to fetch work orders for PO ${poData.rec_name}:`, woError);
          }
          
        } catch (error) {
          const errorMsg = `Failed to import PO ${poData.rec_name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
      
      const processed = Math.min(i + batchSize, productionOrdersData.length);
      progressCallback?.(processed, productionOrdersData.length, `Processed ${processed}/${productionOrdersData.length} production orders...`);
      
      console.log(`Batch ${Math.floor(i / batchSize) + 1} complete: ${productionOrdersImported} POs, ${workOrdersImported} WOs imported, ${skipped} skipped so far...`);
    }
    
  } catch (error) {
    const errorMsg = `Fulfil API import failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    errors.push(errorMsg);
    console.error(errorMsg);
    throw error;
  }
  
  console.log(`=== Recent Fulfil Import Summary ===`);
  console.log(`State: ${state}, Limit: ${limit}`);
  console.log(`✅ Production Orders Imported: ${productionOrdersImported}`);
  console.log(`✅ Work Orders Imported: ${workOrdersImported}`);
  console.log(`⏭️  Skipped: ${skipped} records`);
  console.log(`❌ Errors: ${errors.length} records`);
  console.log(`====================================`);
  
  return {
    productionOrdersImported,
    workOrdersImported,
    skipped,
    errors
  };
}