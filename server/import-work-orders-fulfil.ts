import { FulfilAPIService } from "./fulfil-api.js";
import { db } from "./db.js";
import { productionOrders, workOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Import work orders and extract production orders from Fulfil API
 * Uses production.work endpoint which contains all needed data efficiently
 */
export async function importWorkOrdersFromFulfil(
  limit: number = 1000,
  state: string = "done",
  progressCallback?: ProgressCallback
): Promise<{
  productionOrdersImported: number;
  workOrdersImported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting import of ${limit} ${state} work orders from Fulfil...`);
  
  const fulfil = new FulfilAPIService();
  let productionOrdersImported = 0;
  let workOrdersImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const productionOrdersMap = new Map();
  
  try {
    // Test connection first
    const connectionTest = await fulfil.testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Fulfil API connection failed: ${connectionTest.message}`);
    }
    
    progressCallback?.(0, limit, "Fetching work orders from Fulfil...");
    
    // Fetch work orders using production.work endpoint with all needed fields
    const endpoint = `https://apc.fulfil.io/api/v2/model/production.work`;
    const params = new URLSearchParams();
    params.append('per_page', limit.toString());
    params.append('state', state);
    // Request basic fields that are accessible for UPH calculations
    params.append('fields', 'id,rec_name,production,state,quantity_done,planned_date');
    
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.FULFIL_ACCESS_TOKEN!
      },
      signal: AbortSignal.timeout(60000)
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch work orders: ${response.status} - ${await response.text()}`);
    }

    const responseText = await response.text();
    console.log(`Raw API response: ${responseText.substring(0, 500)}...`);
    
    let workOrdersData;
    try {
      workOrdersData = JSON.parse(responseText);
    } catch (err) {
      throw new Error(`Failed to parse JSON response: ${err}`);
    }
    
    if (!Array.isArray(workOrdersData) || workOrdersData.length === 0) {
      console.log(`No ${state} work orders found in Fulfil. Response type: ${typeof workOrdersData}, Array: ${Array.isArray(workOrdersData)}, Length: ${workOrdersData?.length}`);
      return { productionOrdersImported: 0, workOrdersImported: 0, skipped: 0, errors: [] };
    }
    
    console.log(`Retrieved ${workOrdersData.length} work orders from Fulfil`);
    console.log("Sample work order:", JSON.stringify(workOrdersData[0], null, 2));
    
    // Process work orders and extract unique production orders
    for (let i = 0; i < workOrdersData.length; i++) {
      const woData = workOrdersData[i];
      
      try {
        progressCallback?.(i, workOrdersData.length, `Processing work order ${i + 1}/${workOrdersData.length}`);
        
        // Extract production order ID from the work order
        // Try direct production field first, then extract from rec_name
        let productionId = woData.production;
        let moNumber = null;
        
        if (!productionId && woData.rec_name) {
          // Extract MO number from rec_name format: "WO285 | Sewing - LH | MO5428"
          const parts = woData.rec_name.split(' | ');
          if (parts.length >= 3) {
            moNumber = parts[2]; // "MO5428"
            // Extract numeric ID from MO number
            productionId = parseInt(moNumber.replace('MO', ''));
          }
        }
        
        if (productionId && !productionOrdersMap.has(productionId)) {
          // Check if production order already exists in database
          const existingPO = await db.select({ id: productionOrders.id })
            .from(productionOrders)
            .where(eq(productionOrders.fulfilId, productionId))
            .limit(1);
          
          if (existingPO.length === 0) {
            // Create production order from work order data
            const finalMoNumber = moNumber || `MO${productionId}`;
            
            const [newPO] = await db.insert(productionOrders).values({
              moNumber: finalMoNumber,
              productName: `Product ${productionId}`,
              quantity: woData.quantity_done || 0,
              status: 'done',
              routing: 'Standard',
              dueDate: woData.planned_date || null,
              priority: "Medium",
              fulfilId: productionId,
              rec_name: finalMoNumber
            }).returning({ id: productionOrders.id });
            
            productionOrdersMap.set(productionId, newPO.id);
            productionOrdersImported++;
          } else {
            productionOrdersMap.set(productionId, existingPO[0].id);
          }
        }
        
        // Check if work order already exists
        const existingWO = await db.select({ id: workOrders.id })
          .from(workOrders)
          .where(eq(workOrders.fulfilId, woData.id))
          .limit(1);
        
        if (existingWO.length > 0) {
          skipped++;
          continue;
        }
        
        // Extract work center and operation from multiple sources
        let workCenter = woData['work_center.name'] || 'Unknown';
        let operation = woData['operation.name'] || 'Unknown';
        let operator = null; // Employee field not accessible via API
        
        // If direct fields not available, extract from rec_name
        if (workCenter === 'Unknown' && woData.rec_name && typeof woData.rec_name === 'string') {
          const parts = woData.rec_name.split(' | ');
          if (parts.length >= 2) {
            const operationPart = parts[1]; // "Sewing - LH"
            const operationParts = operationPart.split(' - ');
            workCenter = operationParts[0]; // "Sewing"
            operation = operationPart; // "Sewing - LH"
          }
        }
        
        // Get production order ID from map
        const productionOrderId = productionOrdersMap.get(productionId);
        
        if (productionOrderId) {
          // Insert work order with all required fields
          await db.insert(workOrders).values({
            productionOrderId: productionOrderId,
            workCenter: workCenter,
            operation: operation,
            operator: operator,
            status: woData.state || 'done',
            estimatedHours: 0,
            priority: "Medium",
            routing: 'Standard', // Required field - using default routing
            sequence: 1, // Required field - using default sequence
            fulfilId: woData.id,
            rec_name: woData.rec_name,
            quantityDone: woData.quantity_done || 0,
            plannedDate: typeof woData.planned_date === 'string' ? woData.planned_date : null // Handle date properly
          });
          
          workOrdersImported++;
        }
        
      } catch (error) {
        console.error(`Error processing work order ${woData.id}:`, error);
        errors.push(`Work order ${woData.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    console.log(`Import completed: ${productionOrdersImported} production orders, ${workOrdersImported} work orders imported, ${skipped} skipped`);
    
    return {
      productionOrdersImported,
      workOrdersImported,
      skipped,
      errors
    };
    
  } catch (error) {
    console.error("Import failed:", error);
    errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      productionOrdersImported,
      workOrdersImported,
      skipped,
      errors
    };
  }
}