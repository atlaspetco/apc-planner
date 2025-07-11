import { db } from "./db.js";
import { workCycles, workOrderDurations } from "../shared/schema.js";
import { sql, eq } from "drizzle-orm";

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Extract clean Work Order ID from combined string
 * Examples: "WO13942 | Sewing" -> "WO13942"
 *           "Assembly - LHA | Courtney Banh | Sewing" -> extracts from work_rec_name
 */
function extractWorkOrderId(workRecName: string | null, cycleRecName: string | null): string | null {
  if (!workRecName && !cycleRecName) return null;
  
  // First try work_rec_name (direct WO reference)
  if (workRecName) {
    const woMatch = workRecName.match(/WO\d+/i);
    if (woMatch) return woMatch[0].toUpperCase();
  }
  
  // Then try cycle rec_name as fallback
  if (cycleRecName) {
    const woMatch = cycleRecName.match(/WO\d+/i);
    if (woMatch) return woMatch[0].toUpperCase();
  }
  
  return null;
}

/**
 * Parse duration from hh:mm:ss or h:mm:ss format to seconds
 */
function parseDurationToSeconds(duration: string | number): number {
  if (typeof duration === 'number') return duration;
  if (!duration || duration.toString().trim() === '') return 0;
  
  const durationStr = duration.toString();
  const parts = durationStr.split(':');
  
  if (parts.length === 3) {
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseInt(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  // Handle decimal hours format
  const hours = parseFloat(durationStr);
  if (!isNaN(hours)) {
    return Math.round(hours * 3600);
  }
  
  return 0;
}

/**
 * Aggregate work cycle durations by Work Order ID
 * Following ChatGPT recommendations for one-to-many handling
 */
export async function aggregateWorkOrderDurations(
  progressCallback?: ProgressCallback
): Promise<{
  aggregated: number;
  workOrdersProcessed: number;
  errors: string[];
}> {
  console.log("Starting Work Order duration aggregation...");
  
  let aggregated = 0;
  let workOrdersProcessed = 0;
  const errors: string[] = [];
  
  try {
    progressCallback?.(0, 100, "Fetching work cycles data...");
    
    // Get all work cycles with duration and work order information
    const cycles = await db.select({
      id: workCycles.id,
      duration: workCycles.work_cycles_duration,
      workRecName: workCycles.work_rec_name,
      cycleRecName: workCycles.work_cycles_rec_name,
      operatorName: workCycles.work_cycles_operator_rec_name,
      workCenter: workCycles.work_cycles_work_center_rec_name,
      quantityDone: workCycles.work_cycles_quantity_done,
      productionNumber: workCycles.work_production_number,
      routingName: workCycles.work_production_routing_rec_name,
    }).from(workCycles);
    
    console.log(`Processing ${cycles.length} work cycles for aggregation...`);
    progressCallback?.(10, 100, `Processing ${cycles.length} work cycles...`);
    
    // Group cycles by Work Order ID
    const workOrderGroups = new Map<string, {
      cycles: typeof cycles;
      totalDurationSeconds: number;
      totalQuantityDone: number;
      operatorName: string;
      workCenter: string;
      productionNumber: string;
      routingName: string;
    }>();
    
    let validCycles = 0;
    let skippedNoWorkOrder = 0;
    
    for (const cycle of cycles) {
      const workOrderId = extractWorkOrderId(cycle.workRecName, cycle.cycleRecName);
      
      if (!workOrderId) {
        skippedNoWorkOrder++;
        continue;
      }
      
      validCycles++;
      const durationSeconds = parseDurationToSeconds(cycle.duration || 0);
      const quantityDone = cycle.quantityDone || 0;
      
      if (!workOrderGroups.has(workOrderId)) {
        workOrderGroups.set(workOrderId, {
          cycles: [],
          totalDurationSeconds: 0,
          totalQuantityDone: 0,
          operatorName: cycle.operatorName || '',
          workCenter: cycle.workCenter || '',
          productionNumber: cycle.productionNumber || '',
          routingName: cycle.routingName || '',
        });
      }
      
      const group = workOrderGroups.get(workOrderId)!;
      group.cycles.push(cycle);
      group.totalDurationSeconds += durationSeconds;
      group.totalQuantityDone += quantityDone;
      
      // Use the most recent operator/work center info
      if (cycle.operatorName) group.operatorName = cycle.operatorName;
      if (cycle.workCenter) group.workCenter = cycle.workCenter;
      if (cycle.productionNumber) group.productionNumber = cycle.productionNumber;
      if (cycle.routingName) group.routingName = cycle.routingName;
    }
    
    console.log(`Grouped ${validCycles} cycles into ${workOrderGroups.size} work orders`);
    console.log(`Skipped ${skippedNoWorkOrder} cycles without work order IDs`);
    
    progressCallback?.(50, 100, `Aggregating ${workOrderGroups.size} work orders...`);
    
    // Clear existing aggregated data
    await db.delete(workOrderDurations);
    
    // Insert aggregated work order durations
    const workOrderEntries = Array.from(workOrderGroups.entries());
    let processed = 0;
    
    for (const [workOrderId, group] of workOrderEntries) {
      try {
        const totalDurationHours = group.totalDurationSeconds / 3600;
        
        await db.insert(workOrderDurations).values({
          work_order_id: workOrderId,
          total_duration_seconds: group.totalDurationSeconds,
          total_duration_hours: totalDurationHours,
          cycle_count: group.cycles.length,
          total_quantity_done: group.totalQuantityDone,
          operator_name: group.operatorName,
          work_center: group.workCenter,
          production_number: group.productionNumber,
          routing_name: group.routingName,
          last_updated: new Date(),
        });
        
        aggregated++;
        processed++;
        
        if (processed % 10 === 0) {
          const progress = 50 + Math.round((processed / workOrderEntries.length) * 50);
          progressCallback?.(progress, 100, `Processed ${processed}/${workOrderEntries.length} work orders...`);
        }
        
      } catch (error) {
        const errorMsg = `Failed to aggregate work order ${workOrderId}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
    workOrdersProcessed = workOrderGroups.size;
    
    progressCallback?.(100, 100, `Aggregation complete: ${aggregated} work orders processed`);
    
    console.log(`Work Order aggregation complete:`);
    console.log(`- Processed ${validCycles} work cycles`);
    console.log(`- Aggregated into ${aggregated} work orders`);
    console.log(`- Skipped ${skippedNoWorkOrder} cycles without work order IDs`);
    console.log(`- Errors: ${errors.length}`);
    
    return {
      aggregated,
      workOrdersProcessed,
      errors
    };
    
  } catch (error) {
    const errorMsg = `Work Order aggregation failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    console.error(errorMsg);
    
    return {
      aggregated: 0,
      workOrdersProcessed: 0,
      errors
    };
  }
}

/**
 * Get summary of a specific work order
 */
export async function getWorkOrderSummary(workOrderId: string): Promise<{
  work_order_id: string;
  total_duration_seconds: number;
  total_duration_hours: number;
  cycle_count: number;
  total_quantity_done: number | null;
  operator_name: string | null;
  work_center: string | null;
  production_number: string | null;
  routing_name: string | null;
} | null> {
  console.log(`Looking for work order: ${workOrderId}`);
  
  // Try exact match first
  let result = await db.select()
    .from(workOrderDurations)
    .where(eq(workOrderDurations.work_order_id, workOrderId))
    .limit(1);
  
  // If not found, try partial match for work orders with additional info
  if (result.length === 0) {
    result = await db.select()
      .from(workOrderDurations)
      .where(sql`${workOrderDurations.work_order_id} LIKE ${workOrderId + '%'}`)
      .limit(1);
  }
  
  console.log(`Found ${result.length} results for work order ${workOrderId}`);
  return result[0] || null;
}

/**
 * Get all aggregated work order durations
 */
export async function getAllWorkOrderDurations() {
  const result = await db.select().from(workOrderDurations).orderBy(workOrderDurations.total_duration_hours);
  console.log(`Returning ${result.length} aggregated work order durations`);
  return result;
}