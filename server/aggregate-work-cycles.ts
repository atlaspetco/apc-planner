import { db } from "./db.js";
import { workCycles, uphCalculationData, productionOrders } from "@shared/schema.js";
import { sql, eq, isNotNull, and, gt } from "drizzle-orm";

/**
 * Aggregate work cycles data for UPH calculations
 * Merges multiple work cycles per MO+Operator+WorkCenter, summing durations and quantities
 */
export async function aggregateWorkCyclesForUph(): Promise<{
  success: boolean;
  aggregatedRecords: number;
  message: string;
}> {
  try {
    console.log("Starting work cycles aggregation for UPH calculations...");
    
    // Clear existing aggregated data
    await db.delete(uphCalculationData);
    console.log("Cleared existing UPH calculation data");
    
    // Use Drizzle select query for better type safety
    const { eq, sql: drizzleSql, sum, count, max, isNotNull } = await import("drizzle-orm");
    
    // First get all work cycles with work order ID for proper one-to-many handling
    const rawCycles = await db
      .select({
        workId: workCycles.work_id,
        productionNumber: workCycles.work_production_number,
        productionId: workCycles.work_production_id, 
        operatorName: workCycles.work_cycles_operator_rec_name,
        operatorId: workCycles.work_cycles_operator_id,
        workCenter: workCycles.work_cycles_work_center_rec_name,
        routing: workCycles.work_production_routing_rec_name,
        productCode: workCycles.work_production_product_code,
        quantityDone: workCycles.work_cycles_quantity_done,
        duration: workCycles.work_cycles_duration,
        lastActivity: workCycles.work_cycles_operator_write_date,
        operation: workCycles.work_cycles_rec_name
      })
      .from(workCycles)
      .where(sql`
        ${workCycles.work_cycles_operator_rec_name} IS NOT NULL 
        AND ${workCycles.work_cycles_operator_rec_name} != ''
        AND ${workCycles.work_production_number} IS NOT NULL
        AND ${workCycles.work_cycles_duration} > 0
        AND ${workCycles.work_id} IS NOT NULL
      `);
    
    console.log(`Found ${rawCycles.length} individual work cycles to aggregate`);
    
    // STEP 1: First aggregate by work_id to handle one-to-many cycles per work order
    const workOrderMap = new Map();
    
    for (const cycle of rawCycles) {
      const workId = cycle.workId;
      
      if (!workOrderMap.has(workId)) {
        workOrderMap.set(workId, {
          workId: workId,
          productionNumber: cycle.productionNumber,
          productionId: cycle.productionId,
          operatorName: cycle.operatorName,
          operatorId: cycle.operatorId,
          workCenter: cycle.workCenter,
          routing: cycle.routing,
          productCode: cycle.productCode,
          totalQuantityDone: 0,
          totalDurationSeconds: 0,
          cycleCount: 0,
          lastActivity: cycle.lastActivity,
          operation: cycle.operation
        });
      }
      
      const workOrder = workOrderMap.get(workId);
      workOrder.totalQuantityDone += cycle.quantityDone || 0;
      workOrder.totalDurationSeconds += cycle.duration || 0;
      workOrder.cycleCount += 1;
      
      // Keep latest activity date
      if (cycle.lastActivity && (!workOrder.lastActivity || cycle.lastActivity > workOrder.lastActivity)) {
        workOrder.lastActivity = cycle.lastActivity;
      }
    }
    
    const workOrderData = Array.from(workOrderMap.values());
    console.log(`Aggregated ${rawCycles.length} work cycles into ${workOrderData.length} work orders`);
    
    // Work center consolidation function
    const consolidateWorkCenter = (rawWorkCenter: string): string => {
      if (!rawWorkCenter) return 'Unknown';
      const wc = rawWorkCenter.toLowerCase();
      if (wc.includes('cutting') || wc.includes('cut') || wc.includes('laser') || wc.includes('webbing')) {
        return 'Cutting';
      } else if (wc.includes('sewing') || wc.includes('assembly') || wc.includes('rope') || wc.includes('embroidery')) {
        return 'Assembly';
      } else if (wc.includes('packaging') || wc.includes('pack')) {
        return 'Packaging';
      }
      return rawWorkCenter; // Keep original if no match
    };

    // STEP 2: Now aggregate work orders by operator/workCenter/routing for UPH calculations
    const aggregatedMap = new Map();
    
    for (const workOrder of workOrderData) {
      const consolidatedWorkCenter = consolidateWorkCenter(workOrder.workCenter || '');
      const safeRouting = workOrder.routing || 'Standard';
      const key = `${workOrder.operatorName}-${consolidatedWorkCenter}-${safeRouting}`;
      
      if (!aggregatedMap.has(key)) {
        aggregatedMap.set(key, {
          operatorName: workOrder.operatorName,
          operatorId: workOrder.operatorId,
          workCenter: consolidatedWorkCenter,
          routing: safeRouting,
          productCode: workOrder.productCode,
          totalQuantityDone: 0,
          totalDurationSeconds: 0,
          cycleCount: 0,
          workOrderCount: 0,
          lastActivity: workOrder.lastActivity,
          operations: new Set()
        });
      }
      
      const agg = aggregatedMap.get(key);
      // Only aggregate work orders with positive quantity (excluding setup/downtime)
      if (workOrder.totalQuantityDone > 0) {
        agg.totalQuantityDone += workOrder.totalQuantityDone;
        agg.totalDurationSeconds += workOrder.totalDurationSeconds;
        agg.cycleCount += workOrder.cycleCount;
        agg.workOrderCount += 1;
        
        // Track operation (extract from rec_name)
        const operation = workOrder.operation?.split('|')[0]?.trim() || '';
        if (operation) {
          agg.operations.add(operation);
        }
        
        // Keep latest activity date
        if (workOrder.lastActivity && (!agg.lastActivity || workOrder.lastActivity > agg.lastActivity)) {
          agg.lastActivity = workOrder.lastActivity;
        }
      }
    }
    
    const aggregatedData = Array.from(aggregatedMap.values())
      .filter(agg => agg.totalQuantityDone > 0 && agg.totalDurationSeconds > 0)
      .map(agg => ({
        ...agg,
        operation: Array.from(agg.operations).join(', ')
      }));
    
    console.log(`Aggregated ${workOrderData.length} work orders into ${aggregatedData.length} UPH calculation groups`);
    
    if (aggregatedData.length === 0) {
      return {
        success: true,
        aggregatedRecords: 0,
        message: "No work orders data found to aggregate"
      };
    }
    
    // Use authentic routing data from work orders
    const enrichedData = aggregatedData;
    
    // Transform results for insertion
    const insertData = enrichedData.map((row) => ({
      productionNumber: null, // Not needed for UPH calculations
      productionId: null,     // Not needed for UPH calculations
      operatorName: row.operatorName,
      operatorId: row.operatorId,
      workCenter: row.workCenter,
      routing: row.routing,
      operation: row.operation,
      productCode: row.productCode,
      totalQuantityDone: row.totalQuantityDone,
      totalDurationSeconds: row.totalDurationSeconds,
      cycleCount: row.cycleCount,
      lastActivity: row.lastActivity
    }));
    
    // Insert aggregated data in batches
    const batchSize = 100;
    let insertedCount = 0;
    
    for (let i = 0; i < insertData.length; i += batchSize) {
      const batch = insertData.slice(i, i + batchSize);
      await db.insert(uphCalculationData).values(batch);
      insertedCount += batch.length;
      console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}: ${insertedCount}/${insertData.length} records`);
    }
    
    console.log(`Successfully aggregated ${insertedCount} work cycle groups for UPH calculations`);
    
    return {
      success: true,
      aggregatedRecords: insertedCount,
      message: `Successfully aggregated ${insertedCount} work cycle groups. Multiple cycles per MO are now merged with summed durations and quantities.`
    };
    
  } catch (error) {
    console.error("Error aggregating work cycles:", error);
    return {
      success: false,
      aggregatedRecords: 0,
      message: `Error aggregating work cycles: ${error.message}`
    };
  }
}

/**
 * Get UPH calculations from aggregated data
 * Uses the pre-aggregated table for fast, accurate UPH calculations
 */
export async function calculateUphFromAggregatedData(): Promise<{
  success: boolean;
  calculations: Array<{
    operator: string;
    workCenter: string;
    routing: string;
    operation: string;
    totalQuantity: number;
    totalHours: number;
    unitsPerHour: number;
    observations: number;
    averageHoursPerUnit: number;
  }>;
  message: string;
}> {
  try {
    console.log("Calculating UPH from aggregated work cycles data...");
    
    // Query aggregated data grouped by operator + work center + routing
    // Use SUM(cycle_count) as observations to get actual individual work cycle counts
    const result = await db.execute(sql`
      SELECT 
        operator_name as operator,
        work_center,
        COALESCE(routing, 'Standard') as routing,
        string_agg(DISTINCT operation, ', ') as operation,
        SUM(total_quantity_done) as total_quantity,
        ROUND(SUM(total_duration_seconds) / 3600.0, 2) as total_hours,
        SUM(cycle_count) as observations, -- Use actual work cycle count as observations
        SUM(cycle_count) as total_cycles
      FROM uph_calculation_data
      WHERE total_duration_seconds > 30 -- Minimum 30 seconds per aggregated record
      GROUP BY operator_name, work_center, COALESCE(routing, 'Standard')
      HAVING SUM(total_quantity_done) > 0 AND SUM(total_duration_seconds) > 0
      ORDER BY operator_name, work_center
    `);
    
    const uphResults = result.rows;
    console.log(`Processing ${uphResults.length} UPH calculation groups`);
    
    const calculations = uphResults.map((row: any) => {
      const totalQuantity = parseInt(row.total_quantity);
      const totalHours = parseFloat(row.total_hours);
      const unitsPerHour = totalHours > 0 ? Math.round((totalQuantity / totalHours) * 100) / 100 : 0;
      const averageHoursPerUnit = totalQuantity > 0 ? Math.round((totalHours / totalQuantity) * 10000) / 10000 : 0;
      
      return {
        operator: row.operator,
        workCenter: row.work_center,
        routing: row.routing,
        operation: row.operation,
        totalQuantity,
        totalHours,
        unitsPerHour,
        observations: parseInt(row.observations),
        averageHoursPerUnit
      };
    }).filter(calc => calc.unitsPerHour > 0 && calc.unitsPerHour < 500); // Filter realistic UPH values
    
    console.log(`Generated ${calculations.length} UPH calculations from aggregated data`);
    
    return {
      success: true,
      calculations,
      message: `Successfully calculated UPH for ${calculations.length} operator/work center combinations using aggregated work cycles data`
    };
    
  } catch (error) {
    console.error("Error calculating UPH from aggregated data:", error);
    return {
      success: false,
      calculations: [],
      message: `Error calculating UPH: ${error.message}`
    };
  }
}