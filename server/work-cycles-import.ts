import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import { eq, and, gt, isNotNull } from "drizzle-orm";

// Optimized CSV structure with proper field names and IDs for deduplication
interface WorkCyclesCSVRow {
  'work/cycles/duration'?: string;
  'work/cycles/rec_name'?: string;
  'work/cycles/operator/rec_name'?: string;
  'work/production/routing/rec_name'?: string;
  'work/rec_name'?: string;
  'work/operation/rec_name'?: string;
  'work/operation/id'?: string;
  'work/id'?: string;
  'work/operator/id'?: string;
  'work_center/id'?: string;
  'work/production/id'?: string;
}

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Helper functions to extract field values from either authentic Fulfil or legacy format
 */
function getWorkCycleId(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/id'] || row['Work Cycles ID'] || null;
}

function getWorkCycleRecName(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/rec_name'] || row['Work Cycles Record Name (Title)'] || null;
}

function getOperatorRecName(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/operator/rec_name'] || row['Operator Record Name (Title)'] || null;
}

function getOperatorId(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/operator/id'] || row['Operator ID'] || null;
}

function getWorkCenterRecName(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/work_center/rec_name'] || row['Work CenterRecord Name (Title)'] || null;
}

function getRoutingRecName(row: WorkCyclesCSVRow): string | null {
  return row['work/production/product/boms/routing/rec_name'] || row['Routing Record Name (Title)'] || null;
}

function getQuantityDone(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/quantity_done'] || row['Work Cycles Quantity Done'] || null;
}

function getProductionNumber(row: WorkCyclesCSVRow): string | null {
  return row['work/production/number'] || row['Production Number'] || null;
}

function getProductionId(row: WorkCyclesCSVRow): string | null {
  return row['work/production/id'] || row['Production ID'] || null;
}

function getDuration(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/duration'] || row['Work Cycles Duration (Timestamp)'] || null;
}

function getProductCode(row: WorkCyclesCSVRow): string | null {
  return row['work/production/product/code'] || row['Product Code'] || null;
}

function getProductRecName(row: WorkCyclesCSVRow): string | null {
  return row['work/production/product/rec_name'] || row['Product Record Name (Title)'] || null;
}

function getUpdatedAt(row: WorkCyclesCSVRow): string | null {
  return row['work/cycles/operator/write_date'] || row['Updated At (Timestamp)'] || null;
}

/**
 * Parse timestamp from CSV format and convert to seconds
 */
function parseDurationTimestamp(durationStr: string): number {
  if (!durationStr || durationStr.trim() === '') {
    return 0;
  }
  
  try {
    // Duration might be in format "HH:MM:SS" or timestamp format
    if (durationStr.includes(':')) {
      const parts = durationStr.split(':');
      if (parts.length === 3) {
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseInt(parts[2]) || 0;
        return hours * 3600 + minutes * 60 + seconds;
      }
    }
    
    // Try to parse as number (seconds)
    const numericDuration = parseFloat(durationStr);
    return isNaN(numericDuration) ? 0 : Math.round(numericDuration);
  } catch (error) {
    console.warn(`Failed to parse duration: ${durationStr}`);
    return 0;
  }
}

/**
 * Parse date from various CSV timestamp formats
 */
function parseTimestamp(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '' || dateStr.trim().toLowerCase() === 'null') {
    return null;
  }
  
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Enrich work cycles table with routing data from production orders using production.id
 */
export async function enrichWorkCyclesWithRouting(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  try {
    console.log('Starting work cycles routing enrichment...');
    
    // Get all work cycles that have production_id but no routing data
    const cyclesNeedingRouting = await db
      .select({
        id: workCycles.id,
        productionId: workCycles.work_production_id
      })
      .from(workCycles)
      .where(
        and(
          isNotNull(workCycles.work_production_id),
          eq(workCycles.work_production_routing_rec_name, 'Unknown')
        )
      )
      .limit(50); // Process in small batches to avoid API rate limits

    console.log(`Found ${cyclesNeedingRouting.length} work cycles needing routing data`);

    if (cyclesNeedingRouting.length === 0) {
      return { updated: 0, errors: [] };
    }

    // Group by production_id to minimize API calls
    const productionIds = [...new Set(cyclesNeedingRouting.map(c => c.productionId))].filter(Boolean);
    console.log(`Processing ${productionIds.length} unique production orders`);
    
    for (const productionId of productionIds) {
      try {
        // Fetch routing data from production order endpoint
        const response = await fetch('https://apc.fulfil.io/api/v2/model/production.order/search_read', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': process.env.FULFIL_ACCESS_TOKEN || ''
          },
          body: JSON.stringify({
            filters: [['id', '=', parseInt(productionId.toString())]],
            fields: ['id', 'routing.name']
          })
        });

        if (!response.ok) {
          if (response.status === 429) {
            errors.push(`Rate limited on production order ${productionId}`);
            break; // Stop processing to avoid further rate limiting
          }
          errors.push(`Failed to fetch production order ${productionId}: ${response.status}`);
          continue;
        }

        const productionOrders = await response.json();
        
        if (productionOrders.length > 0 && productionOrders[0]['routing.name']) {
          const routingName = productionOrders[0]['routing.name'];
          
          // Update all work cycles with this production_id
          await db
            .update(workCycles)
            .set({ work_production_routing_rec_name: routingName })
            .where(eq(workCycles.work_production_id, productionId.toString()));
          
          const cycleCount = cyclesNeedingRouting.filter(c => c.productionId === productionId).length;
          updated += cycleCount;
          console.log(`Updated ${cycleCount} cycles with routing: ${routingName}`);
        }

        // Add delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        errors.push(`Error processing production order ${productionId}: ${error}`);
      }
    }

    console.log(`Routing enrichment complete. Updated ${updated} cycles with ${errors.length} errors`);

  } catch (error) {
    errors.push(`Database error: ${error}`);
  }

  return { updated, errors };
}

/**
 * Import work cycles data from CSV for authentic UPH calculations
 */
export async function importWorkCycles(
  csvData: WorkCyclesCSVRow[],
  progressCallback?: ProgressCallback
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting work cycles import for ${csvData.length} records...`);
  
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchSize = 50;
  
  // Process in batches for better performance
  for (let batchStart = 0; batchStart < csvData.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, csvData.length);
    const batch = csvData.slice(batchStart, batchEnd);
    
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const globalIndex = batchStart + i;
      
      // Skip rows without valid work order ID - use work/id as the primary identifier
      const workIdStr = row['work/id'];
      if (!workIdStr || workIdStr.trim() === '' || workIdStr.trim() === 'null') {
        if (globalIndex < 5) {
          console.log(`Row ${globalIndex + 1}: Skipping due to missing work ID. Available fields:`, Object.keys(row));
        }
        skipped++;
        continue;
      }
      
      try {
        const workId = parseInt(workIdStr);
        if (isNaN(workId)) {
          errors.push(`Row ${globalIndex + 1}: Invalid work ID "${workIdStr}"`);
          skipped++;
          continue;
        }
        
        // Multiple cycles can exist for the same work order with different operators
        // Each row represents a unique cycle instance - use composite key for duplicate checking
        const operatorRecName = getOperatorRecName(row) || 'Unknown';
        const productionNumber = getProductionNumber(row) || 'Unknown';
        const duration = getDuration(row) || '';
        
        // Create unique identifier from multiple fields to handle one-to-many relationship
        const compositeKey = `${workId}-${operatorRecName}-${productionNumber}-${duration}`;
        
        // Check if this exact combination already exists
        const existing = await db.select({ id: workCycles.id })
          .from(workCycles)
          .where(eq(workCycles.work_id, workId))
          .limit(1);
        
        // Only skip if we find an exact match with same operator and duration
        if (existing.length > 0) {
          const existingCycle = existing[0];
          const existingOperator = await db.select({ 
            operatorRecName: workCycles.work_cycles_operator_rec_name, 
            duration: workCycles.work_cycles_duration 
          })
            .from(workCycles)
            .where(eq(workCycles.id, existingCycle.id))
            .limit(1);
          
          if (existingOperator.length > 0 && 
              existingOperator[0].operatorRecName === operatorRecName &&
              existingOperator[0].duration === parseDurationTimestamp(duration)) {
            if (globalIndex < 5) {
              console.log(`Row ${globalIndex + 1}: Skipping exact duplicate cycle for ${operatorRecName} on ${productionNumber}`);
            }
            skipped++;
            continue;
          }
        }
        
        // Parse fields directly from optimized CSV structure
        const cycleDuration = row['work/cycles/duration'] ? parseFloat(row['work/cycles/duration']) : 0;
        const operatorId = row['work/operator/id'] ? parseInt(row['work/operator/id']) : null;
        const productionId = row['work/production/id'] ? parseInt(row['work/production/id']) : null;
        const operationId = row['work/operation/id'] ? parseInt(row['work/operation/id']) : null;
        const workCenterId = row['work_center/id'] ? parseInt(row['work_center/id']) : null;
        
        // Build work cycle data object with optimized field mapping
        const workCycleData = {
          // Use work_id as the unique identifier for this work cycle record
          fulfilId: workId,
          // Authentic Fulfil API fields
          work_cycles_rec_name: row['work/cycles/rec_name'] || '',
          work_cycles_operator_rec_name: row['work/cycles/operator/rec_name'] || '',
          work_cycles_operator_id: operatorId,
          work_cycles_duration: cycleDuration,
          work_production_id: productionId,
          work_production_routing_rec_name: row['work/production/routing/rec_name'] || '',
          work_rec_name: row['work/rec_name'] || '',
          work_operation_rec_name: row['work/operation/rec_name'] || '',
          work_operation_id: operationId,
          work_id: workId,
          work_operator_id: operatorId,
          work_center_id: workCenterId,
        };
        
        // Debug logging for first few rows
        if (globalIndex < 5) {
          console.log(`Row ${globalIndex + 1}: Attempting to insert work cycle data:`, JSON.stringify(workCycleData, null, 2));
        }
        
        await db.insert(workCycles).values(workCycleData);
        imported++;
        
        if (globalIndex < 5) {
          console.log(`Row ${globalIndex + 1}: Successfully imported work cycle ${workId}`);
        }
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Row ${globalIndex + 1}: ${errorMsg}`);
        if (globalIndex < 5) {
          console.log(`Row ${globalIndex + 1}: Failed to import due to:`, errorMsg);
        }
        skipped++;
      }
    }
    
    // Update progress after each batch
    const processed = batchEnd;
    if (progressCallback) {
      progressCallback(
        processed,
        csvData.length,
        `Processed ${imported} work cycles, ${skipped} skipped...`
      );
    }
    
    console.log(`Batch ${Math.ceil(processed / batchSize)} complete: ${imported} imported, ${skipped} skipped so far...`);
  }
  
  console.log(`Work cycles import complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);
  
  return {
    imported,
    skipped,
    errors
  };
}

/**
 * Calculate UPH from imported work cycles data
 */
export async function calculateUphFromWorkCycles(): Promise<{
  calculations: Array<{
    operator: string;
    workCenter: string;
    operation: string;
    routing: string;
    totalQuantity: number;
    totalDurationHours: number;
    unitsPerHour: number;
    cycleCount: number;
  }>;
  summary: {
    totalCycles: number;
    uniqueOperators: number;
    uniqueWorkCenters: number;
    uniqueRoutings: number;
  };
}> {
  console.log('Calculating UPH from work cycles data...');
  
  // Get all work cycles with required data using authentic Fulfil field names
  const cycles = await db.select({
    operatorRecName: workCycles.work_cycles_operator_rec_name,
    workCenterRecName: workCycles.work_cycles_work_center_rec_name,
    workCycleRecName: workCycles.work_cycles_rec_name,
    routingRecName: workCycles.work_production_routing_rec_name, // authentic field
    quantityDone: workCycles.work_cycles_quantity_done,
    duration: workCycles.work_cycles_duration,
    productionNumber: workCycles.work_production_number,
    productCode: workCycles.work_production_product_code
  }).from(workCycles)
  .where(
    and(
      gt(workCycles.work_cycles_duration, 0),
      gt(workCycles.work_cycles_quantity_done, 0),
      isNotNull(workCycles.work_cycles_operator_rec_name)
    )
  );
  
  console.log(`Found ${cycles.length} valid work cycles for UPH calculation`);
  
  // Routing data is already included in CSV, no need for additional lookup
  
  // First, analyze operations per work center to determine grouping strategy
  const operationsByWorkCenter = new Map<string, Set<string>>();
  
  for (const cycle of cycles) {
    const workCenter = cycle.workCenterRecName || 'Unknown';
    let operation = 'Unknown';
    if (cycle.workCycleRecName) {
      const operationMatch = cycle.workCycleRecName.split(' | ')[0].trim();
      if (operationMatch) {
        operation = operationMatch;
      }
    }
    
    if (!operationsByWorkCenter.has(workCenter)) {
      operationsByWorkCenter.set(workCenter, new Set());
    }
    operationsByWorkCenter.get(workCenter)!.add(operation);
  }

  // Group using sophisticated strategy based on operations per work center
  const grouped = new Map<string, {
    operator: string;
    workCenter: string;
    operation: string;
    routing: string;
    totalQuantity: number;
    totalDuration: number;
    cycleCount: number;
  }>();
  
  for (const cycle of cycles) {
    // Clean operator name - remove work center contamination from operator field
    let operatorName = cycle.operatorRecName || 'Unknown';
    if (operatorName.includes(' / ')) {
      operatorName = operatorName.split(' / ')[0].trim();
    }
    if (operatorName.includes(' | ')) {
      operatorName = operatorName.split(' | ')[0].trim();
    }
    
    // Extract operation from work_cycles_rec_name (e.g., "Cutting - Webbing | Courtney Banh | Cutting")
    let operation = 'Unknown';
    if (cycle.workCycleRecName) {
      const operationMatch = cycle.workCycleRecName.split(' | ')[0].trim();
      if (operationMatch) {
        operation = operationMatch;
      }
    }
    
    // Get routing from CSV data, fallback to Standard
    const routing = cycle.routingRecName || 'Standard';
    const workCenter = cycle.workCenterRecName || 'Unknown';
    
    // Apply sophisticated grouping strategy:
    // - If work center has only one operation: Group by operator + operation + routing
    // - If work center has multiple operations: Combine durations by operator + routing
    const operationsInWorkCenter = operationsByWorkCenter.get(workCenter)?.size || 1;
    let key: string;
    let groupOperation: string;
    
    if (operationsInWorkCenter === 1) {
      // Single operation per work center: detailed grouping by operation
      key = `${operatorName}|${operation}|${routing}`;
      groupOperation = operation;
    } else {
      // Multiple operations per work center: combine all operations under this work center
      key = `${operatorName}|${workCenter}_COMBINED|${routing}`;
      groupOperation = `${workCenter} (Combined)`;
    }
    
    if (!grouped.has(key)) {
      grouped.set(key, {
        operator: operatorName,
        workCenter: workCenter,
        operation: groupOperation,
        routing: routing,
        totalQuantity: 0,
        totalDuration: 0,
        cycleCount: 0
      });
    }
    
    const group = grouped.get(key)!;
    group.totalQuantity += cycle.quantityDone || 0;
    group.totalDuration += cycle.duration || 0;
    group.cycleCount += 1;
  }
  
  // Calculate UPH for each group with more inclusive filtering
  const calculations = Array.from(grouped.values()).map(group => ({
    operator: group.operator,
    workCenter: group.workCenter,
    operation: group.operation,
    routing: group.routing,
    totalQuantity: group.totalQuantity,
    totalDurationHours: group.totalDuration / 3600, // Convert seconds to hours
    unitsPerHour: group.totalDuration > 0 ? (group.totalQuantity / (group.totalDuration / 3600)) : 0,
    cycleCount: group.cycleCount,
    observations: group.cycleCount // Add observations for UI display
  })).filter(calc => 
    calc.unitsPerHour > 0 && 
    calc.unitsPerHour < 500 && // Reasonable UPH upper limit for manufacturing
    calc.totalDurationHours >= 0.008 && // At least 30 seconds of work
    calc.totalQuantity >= 1 && // Minimum production quantity
    calc.cycleCount >= 1 // Include single observations for broader coverage
  );
  
  const uniqueOperators = new Set(cycles.map(c => c.operatorRecName).filter(Boolean)).size;
  const uniqueWorkCenters = new Set(cycles.map(c => c.workCenterRecName).filter(Boolean)).size;
  const uniqueRoutings = new Set(cycles.map(c => c.routingRecName).filter(Boolean)).size;
  
  console.log(`Calculated UPH for ${calculations.length} operator/work center/routing combinations`);
  
  // Store UPH calculations in database
  const { uphData, operators } = await import("../shared/schema.js");
  
  // First, ensure all operators exist in database (create missing ones)
  const uniqueOperatorNames = Array.from(new Set(calculations.map(calc => calc.operator)));
  
  for (const operatorName of uniqueOperatorNames) {
    // Check if operator exists
    const existing = await db.select().from(operators).where(eq(operators.name, operatorName)).limit(1);
    
    if (existing.length === 0) {
      console.log(`Creating missing operator: ${operatorName}`);
      await db.insert(operators).values({
        name: operatorName,
        isActive: true
      });
    }
  }
  
  // Get all operators for name-to-ID mapping (refresh after creating missing ones)
  const operatorsData = await db.select({
    id: operators.id,
    name: operators.name
  }).from(operators);
  
  const operatorNameToId = new Map<string, number>();
  for (const op of operatorsData) {
    operatorNameToId.set(op.name, op.id);
  }
  
  if (calculations.length > 0) {
    // Clear existing UPH data
    await db.delete(uphData);
    console.log('Cleared existing UPH data');
    
    // Insert new calculations with operator_id references
    let stored = 0;
    for (const calc of calculations) {
      const operatorId = operatorNameToId.get(calc.operator);
      if (operatorId) {
        await db.insert(uphData).values({
          routing: calc.routing,
          workCenter: calc.workCenter,
          operation: calc.operation, // Now using extracted operation from work cycles
          operatorId: operatorId,
          unitsPerHour: calc.unitsPerHour,
          calculationPeriod: calc.cycleCount // Use actual number of work cycle observations
        });
        stored++;
      } else {
        console.log(`Skipping UPH storage for unknown operator: ${calc.operator}`);
      }
    }
    
    console.log(`Stored ${stored} UPH calculations in database (out of ${calculations.length} calculated)`);
  }
  
  return {
    calculations,
    summary: {
      totalCycles: cycles.length,
      uniqueOperators,
      uniqueWorkCenters,
      uniqueRoutings
    }
  };
}