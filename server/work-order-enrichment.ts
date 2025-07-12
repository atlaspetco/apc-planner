import { db } from "./db.js";
import { workOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";
import { parseRecName } from "./rec-name-parser.js";

/**
 * Enriches work orders with routing and operation data parsed from rec_name field
 * This fixes the missing routing issue by extracting WO# and MO# from rec_name
 */
export async function enrichWorkOrdersFromRecName() {
  console.log("🔄 Starting work order enrichment from rec_name parsing...");
  
  try {
    // Get all work orders from local database
    const allWorkOrders = await db.select().from(workOrders);
    console.log(`📋 Found ${allWorkOrders.length} work orders to enrich with rec_name parsing`);
    
    let enrichedCount = 0;
    let updatedRecords = [];
    
    for (const wo of allWorkOrders) {
      if (!wo.rec_name) {
        console.log(`⚠️ Skipping work order ${wo.id} - no rec_name field`);
        continue;
      }
      
      try {
        // Parse the rec_name field to extract routing information
        const parsed = parseRecName(wo.rec_name);
        console.log(`🔍 Parsing WO ${wo.id}: "${wo.rec_name}" → `, parsed);
        
        // Update work order with parsed routing data
        const updateData: any = {};
        
        if (parsed.operation) {
          updateData.operation = parsed.operation;
          updateData.operationName = parsed.operation;
        }
        
        if (parsed.workCenter) {
          updateData.workCenterName = parsed.workCenter;
          updateData.work_center = parsed.workCenter; // Also update the legacy field
        }
        
        // Extract MO number and use it as routing
        if (parsed.manufacturingOrderNumber) {
          updateData.routing = parsed.manufacturingOrderNumber;
        }
        
        // Only update if we have meaningful data to add
        if (Object.keys(updateData).length > 0) {
          await db
            .update(workOrders)
            .set(updateData)
            .where(eq(workOrders.id, wo.id));
          
          console.log(`✅ Updated WO ${wo.id} with:`, updateData);
          enrichedCount++;
          updatedRecords.push({
            id: wo.id,
            rec_name: wo.rec_name,
            parsed: parsed,
            updates: updateData
          });
        }
        
      } catch (error) {
        console.log(`❌ Error parsing WO ${wo.id} rec_name "${wo.rec_name}":`, error);
        continue;
      }
    }
    
    console.log(`🎯 Work order enrichment complete: ${enrichedCount}/${allWorkOrders.length} work orders updated`);
    
    return { 
      success: true, 
      enrichedCount, 
      totalWorkOrders: allWorkOrders.length,
      updatedRecords,
      message: `Successfully enriched ${enrichedCount} work orders with routing data from rec_name parsing`
    };
    
  } catch (error) {
    console.error("Work order rec_name enrichment failed:", error);
    throw error;
  }
}

/**
 * Extracts unique routing information from all work order rec_names
 */
export async function analyzeWorkOrderRoutings() {
  console.log("📊 Analyzing work order routing patterns from rec_name fields...");
  
  try {
    const allWorkOrders = await db.select().from(workOrders);
    const routingAnalysis = {
      totalWorkOrders: allWorkOrders.length,
      workOrderNumbers: new Set<string>(),
      manufacturingOrders: new Set<string>(),
      operations: new Set<string>(),
      workCenters: new Set<string>(),
      recNamePatterns: [] as any[]
    };
    
    for (const wo of allWorkOrders) {
      if (wo.rec_name) {
        const parsed = parseRecName(wo.rec_name);
        
        if (parsed.workOrderNumber) {
          routingAnalysis.workOrderNumbers.add(parsed.workOrderNumber);
        }
        if (parsed.manufacturingOrderNumber) {
          routingAnalysis.manufacturingOrders.add(parsed.manufacturingOrderNumber);
        }
        if (parsed.operation) {
          routingAnalysis.operations.add(parsed.operation);
        }
        if (parsed.workCenter) {
          routingAnalysis.workCenters.add(parsed.workCenter);
        }
        
        routingAnalysis.recNamePatterns.push({
          id: wo.id,
          rec_name: wo.rec_name,
          parsed: parsed
        });
      }
    }
    
    const summary = {
      totalWorkOrders: routingAnalysis.totalWorkOrders,
      uniqueWorkOrders: routingAnalysis.workOrderNumbers.size,
      uniqueManufacturingOrders: routingAnalysis.manufacturingOrders.size,
      uniqueOperations: routingAnalysis.operations.size,
      uniqueWorkCenters: routingAnalysis.workCenters.size,
      workOrderNumbers: Array.from(routingAnalysis.workOrderNumbers).sort(),
      manufacturingOrders: Array.from(routingAnalysis.manufacturingOrders).sort(),
      operations: Array.from(routingAnalysis.operations).sort(),
      workCenters: Array.from(routingAnalysis.workCenters).sort(),
      sampleParsedRecords: routingAnalysis.recNamePatterns.slice(0, 10)
    };
    
    console.log("📈 Routing analysis complete:", summary);
    return summary;
    
  } catch (error) {
    console.error("Work order routing analysis failed:", error);
    throw error;
  }
}