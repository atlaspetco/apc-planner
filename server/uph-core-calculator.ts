import { db } from "./db.js";
import { workCycles, productionOrders, operators } from "../shared/schema.js";
import { eq, or, isNull, sql } from "drizzle-orm";

export interface UphCalculationResult {
  operatorName: string;
  workCenter: string;
  routing: string;
  unitsPerHour: number;
  observations: number;
  moUphValues: number[];
}

export interface MoGroupData {
  operatorName: string;
  workCenter: string;
  routing: string;
  moNumber: string;
  totalDurationSeconds: number;
  moQuantity: number;
  cycleCount: number;
  woNumber?: string;
  createDate?: string;
  actualWorkCenter?: string;
  operations?: string;
  productionId?: number; // Add production ID for correct Fulfil link
  workOrderId?: number; // Work order ID for correct Fulfil link
}

// Core work center consolidation logic
export function consolidateWorkCenter(wc: string | null): string | null {
  if (!wc) return null;
  const wcLower = wc.toLowerCase().trim();
  
  // Check for Assembly-related work centers (including exact matches)
  if (wcLower === 'sewing' || wcLower === 'rope' || 
      wcLower.includes('sewing') || wcLower.includes('rope') || 
      wcLower.includes('assembly')) {
    return 'Assembly';
  } else if (wcLower === 'cutting' || wcLower.includes('cutting')) {
    return 'Cutting';
  } else if (wcLower === 'packaging' || wcLower.includes('packaging')) {
    return 'Packaging';
  }
  return wc;
}

// Core UPH calculation function used by ALL endpoints
export async function calculateCoreUph(
  filters?: {
    operatorFilter?: string;
    workCenterFilter?: string;
    routingFilter?: string;
    timeWindowDays?: number; // Override operator's default time window
    bypassDateFilter?: boolean; // Allow bypassing date filter for analytics
  }
): Promise<UphCalculationResult[]> {
  console.log('=== CORE UPH CALCULATOR STARTED ===', filters);
  
  // Fetch all necessary data - EXCLUDE CORRUPTED RECORDS
  const allCycles = await db.select().from(workCycles).where(
    or(
      eq(workCycles.data_corrupted, false),
      isNull(workCycles.data_corrupted)
    )
  );
  const allProductionOrders = await db.select().from(productionOrders);
  const allOperators = await db.select().from(operators);
  
  console.log(`Loaded ${allCycles.length} CLEAN work cycles and ${allProductionOrders.length} production orders`);
  
  // Create operator time window map
  const operatorTimeWindows = new Map<string, number>();
  allOperators.forEach(op => {
    operatorTimeWindows.set(op.name, op.uphCalculationWindow || 30);
  });
  
  // Create MO quantity map
  const moQuantityMap = new Map<string, number>();
  allProductionOrders.forEach(po => {
    if (po.moNumber && po.quantity) {
      moQuantityMap.set(po.moNumber, po.quantity);
    }
  });
  
  // Create routing map
  const routingMap = new Map<string, string>();
  allProductionOrders.forEach(po => {
    if (po.moNumber && po.routing) {
      routingMap.set(po.moNumber, po.routing);
    }
  });
  
  // Apply filters if provided
  let filteredCycles = allCycles;
  
  if (filters?.operatorFilter) {
    filteredCycles = filteredCycles.filter(c => 
      c.work_cycles_operator_rec_name === filters.operatorFilter
    );
  }
  
  if (filters?.workCenterFilter) {
    filteredCycles = filteredCycles.filter(c => {
      const consolidated = consolidateWorkCenter(c.work_cycles_work_center_rec_name);
      return consolidated === filters.workCenterFilter;
    });
  }
  
  if (filters?.routingFilter) {
    filteredCycles = filteredCycles.filter(c => {
      const routing = routingMap.get(c.work_production_number || '') || 
                     c.work_production_routing_rec_name;
      return routing === filters.routingFilter;
    });
  }
  
  // Apply date filtering based on operator's time window (unless bypassed)
  if (!filters?.bypassDateFilter) {
    const now = new Date();
    
    filteredCycles = filteredCycles.filter(cycle => {
      // Get the operator's time window setting
      const operatorName = cycle.work_cycles_operator_rec_name;
      if (!operatorName) return false;
      
      const timeWindowDays = filters?.timeWindowDays || operatorTimeWindows.get(operatorName) || 30;
      const cutoffDate = new Date(now.getTime() - (timeWindowDays * 24 * 60 * 60 * 1000));
      
      // Use work production create date if available, otherwise use cycle creation date
      const cycleDate = cycle.work_production_create_date || cycle.createdAt;
      if (!cycleDate) return true; // Include if no date available
      
      return new Date(cycleDate) >= cutoffDate;
    });
    
    console.log(`After date filtering: ${filteredCycles.length} cycles remain`);
  } else {
    console.log(`Date filtering bypassed: ${filteredCycles.length} cycles included`);
  }
  
  // STEP 1: Group by work_production_id + operator + work_center + routing
  const moGroupedData = new Map<string, MoGroupData>();
  
  filteredCycles.forEach(cycle => {
    if (!cycle.work_cycles_operator_rec_name || 
        !cycle.work_cycles_work_center_rec_name || 
        !cycle.work_production_id ||
        !cycle.work_cycles_duration ||
        cycle.work_cycles_duration <= 0 ||
        !cycle.work_production_quantity) {
      return;
    }
    
    const consolidatedWC = consolidateWorkCenter(cycle.work_cycles_work_center_rec_name);
    if (!consolidatedWC) return;
    
    const routing = cycle.work_production_routing_rec_name || 'Unknown';
    const productionId = cycle.work_production_id.toString();
                   
    const groupKey = `${cycle.work_cycles_operator_rec_name}|${consolidatedWC}|${routing}|${productionId}`;
    
    // Get the correct MO number from production orders table
    const actualMoNumber = moQuantityMap.has(`MO${productionId}`) ? `MO${productionId}` : 
                          allProductionOrders.find(po => po.id === cycle.work_production_id)?.mo_number || 
                          `CYCLE_${cycle.work_cycles_id}`;
    
    // Get the correct quantity - prefer production orders table over work cycles
    const actualQuantity = allProductionOrders.find(po => po.id === cycle.work_production_id)?.quantity || 
                          cycle.work_production_quantity;
    
    if (!moGroupedData.has(groupKey)) {
      moGroupedData.set(groupKey, {
        operatorName: cycle.work_cycles_operator_rec_name,
        workCenter: consolidatedWC,
        routing,
        moNumber: actualMoNumber, // Use actual MO number from production orders
        totalDurationSeconds: 0,
        moQuantity: actualQuantity, // Use actual quantity from production orders
        cycleCount: 0,
        productionId: cycle.work_production_id
      });
    }
    
    const group = moGroupedData.get(groupKey)!;
    group.cycleCount++;
    
    // Sum durations in seconds for this operator+work_center+production_id combination
    group.totalDurationSeconds += cycle.work_cycles_duration;
  });
  
  // Calculate UPH per MO then average by operator/workCenter/routing
  const operatorGroupedData = new Map<string, {
    operatorName: string;
    workCenter: string;
    routing: string;
    moUphValues: number[];
    totalObservations: number;
  }>();
  
  moGroupedData.forEach(moData => {
    // Skip if no quantity or duration
    if (moData.moQuantity <= 0 || moData.totalDurationSeconds <= 0) return;
    
    const durationHours = moData.totalDurationSeconds / 3600;
    const uphPerMo = moData.moQuantity / durationHours;
    
    console.log(`📊 Production ID ${moData.productionId}: ${moData.operatorName} ${moData.workCenter}/${moData.routing} - Quantity=${moData.moQuantity}, Duration=${durationHours.toFixed(2)}hrs, UPH=${uphPerMo.toFixed(2)}`);
    
    // No UPH limit filtering - all values accepted as requested
    
    const operatorKey = `${moData.operatorName}|${moData.workCenter}|${moData.routing}`;
    
    if (!operatorGroupedData.has(operatorKey)) {
      operatorGroupedData.set(operatorKey, {
        operatorName: moData.operatorName,
        workCenter: moData.workCenter,
        routing: moData.routing,
        moUphValues: [],
        totalObservations: 0
      });
    }
    
    const operatorGroup = operatorGroupedData.get(operatorKey)!;
    operatorGroup.moUphValues.push(uphPerMo);
    operatorGroup.totalObservations++;
  });
  
  // Apply statistical outlier detection before calculating averages
  const results = Array.from(operatorGroupedData.values()).map(group => {
    if (group.moUphValues.length === 0) {
      return {
        operatorName: group.operatorName,
        workCenter: group.workCenter,
        routing: group.routing,
        unitsPerHour: 0,
        observations: 0,
        moUphValues: []
      };
    }

    // Apply statistical outlier detection
    let finalValues = group.moUphValues;
    
    // Filter extreme outliers (UPH > 1000)
    finalValues = finalValues.filter(uph => uph <= 1000);
    
    if (finalValues.length > 3) {
      // Calculate mean and standard deviation
      const mean = finalValues.reduce((sum, uph) => sum + uph, 0) / finalValues.length;
      const variance = finalValues.reduce((sum, uph) => sum + Math.pow(uph - mean, 2), 0) / finalValues.length;
      const stdDev = Math.sqrt(variance);
      
      // Filter values outside 2 standard deviations
      const lowerBound = mean - (2 * stdDev);
      const upperBound = mean + (2 * stdDev);
      
      const beforeCount = finalValues.length;
      finalValues = finalValues.filter(uph => uph >= lowerBound && uph <= upperBound);
      
      if (beforeCount !== finalValues.length) {
        console.log(`📊 Outlier filter: ${group.operatorName} ${group.workCenter} ${group.routing}: ${beforeCount} → ${finalValues.length} values (removed ${beforeCount - finalValues.length} outliers)`);
      }
    }

    return {
      operatorName: group.operatorName,
      workCenter: group.workCenter,
      routing: group.routing,
      unitsPerHour: finalValues.length > 0 
        ? finalValues.reduce((sum, uph) => sum + uph, 0) / finalValues.length 
        : 0,
      observations: finalValues.length,
      moUphValues: finalValues
    };
  });
  
  console.log(`=== CORE UPH CALCULATOR COMPLETE: ${results.length} results ===`);
  
  // Save corrected UPH results to database
  const { db: database } = await import("./db.js");
  const { uphData } = await import("../shared/schema.js");
  
  // Clear existing UPH data
  await database.delete(uphData);
  console.log("🗑️ Cleared existing UPH data");
  
  // Insert corrected UPH data
  for (const result of results) {
    if (result.unitsPerHour > 0 && result.observations > 0) {
      // Find operator ID
      const { operators } = await import("../shared/schema.js");
      const [operator] = await database.select().from(operators).where(eq(operators.name, result.operatorName));
      
      if (operator) {
        await database.insert(uphData).values({
          operatorId: operator.id,
          operatorName: result.operatorName,
          workCenter: result.workCenter,
          operation: result.workCenter, // Use work center as operation for now
          routing: result.routing,
          productRouting: result.routing, // Fix: Add required productRouting field
          uph: result.unitsPerHour,
          observationCount: result.observations,
          totalDurationHours: result.observations, // Placeholder, will be calculated properly
          totalQuantity: Math.round(result.unitsPerHour * result.observations), // Approximate
          dataSource: 'work_cycles',
          lastUpdated: new Date().toISOString()
        });
      }
    }
  }
  
  console.log(`✅ Saved ${results.length} corrected UPH calculations to database`);
  
  return results;
}

// Get UPH details for a specific operator/workCenter/routing combination
export async function getCoreUphDetails(
  operatorName: string,
  workCenter: string,
  routing: string
): Promise<{
  cycles: any[];
  moGroupedData: MoGroupData[];
  averageUph: number;
}> {
  console.log(`🚨🚨🚨 getCoreUphDetails STARTED: operator="${operatorName}", workCenter="${workCenter}", routing="${routing}"`);
  
  // URGENT DEBUG: Execute raw SQL to compare with ORM results
  console.log(`🚨🚨🚨 EXECUTING RAW SQL TEST`);
  const rawResult = await db.execute(sql`SELECT COUNT(*) as count FROM work_cycles WHERE work_cycles_operator_rec_name = 'Courtney Banh' AND (data_corrupted = false OR data_corrupted IS NULL)`);
  console.log(`🚨 RAW SQL: Courtney Banh cycles = ${rawResult.rows[0]?.count || 0}`);
  
  // Fetch all necessary data - EXCLUDE CORRUPTED RECORDS
  const allCycles = await db.select().from(workCycles).where(
    or(
      eq(workCycles.data_corrupted, false),
      isNull(workCycles.data_corrupted)
    )
  );
  const allProductionOrders = await db.select().from(productionOrders);
  
  console.log(`🚨 ORM QUERY: Loaded ${allCycles.length} cycles total, ${allProductionOrders.length} production orders`);
  
  // Test: Check if Courtney Banh cycles are in the result
  const courtneyTestCycles = allCycles.filter(c => c.work_cycles_operator_rec_name === 'Courtney Banh');
  console.log(`🚨 ORM RESULT: Found ${courtneyTestCycles.length} Courtney Banh cycles in query result`);
  
  // Count cycles by operator for debugging
  const operatorCounts = new Map<string, number>();
  allCycles.forEach(cycle => {
    if (cycle.work_cycles_operator_rec_name) {
      operatorCounts.set(cycle.work_cycles_operator_rec_name, (operatorCounts.get(cycle.work_cycles_operator_rec_name) || 0) + 1);
    }
  });
  
  // Check specifically for Courtney Banh
  const courtneyCount = operatorCounts.get('Courtney Banh') || 0;
  console.log(`🚨 COURTNEY BANH cycle count: ${courtneyCount}`);
  console.log(`🚨 First 10 operator counts:`, Array.from(operatorCounts.entries()).slice(0, 10));
  
  // Create MO quantity map
  const moQuantityMap = new Map<string, number>();
  allProductionOrders.forEach(po => {
    if (po.moNumber && po.quantity) {
      moQuantityMap.set(po.moNumber, po.quantity);
    }
  });
  
  // Create routing map
  const routingMap = new Map<string, string>();
  allProductionOrders.forEach(po => {
    if (po.moNumber && po.routing) {
      routingMap.set(po.moNumber, po.routing);
    }
  });
  
  // CRITICAL DEBUG: Check if Courtney Banh exists before filtering
  const courtneyCheck = allCycles.filter(c => c.work_cycles_operator_rec_name === 'Courtney Banh').length;
  console.log(`🚨🚨 BEFORE FILTER: ${courtneyCheck} Courtney Banh cycles found in allCycles`);
  


  // Filter cycles for this specific combination
  const filteredCycles = allCycles.filter(cycle => {
    if (!cycle.work_cycles_operator_rec_name || 
        !cycle.work_cycles_work_center_rec_name) {
      return false;
    }
    
    // Check operator
    if (cycle.work_cycles_operator_rec_name !== operatorName) {
      return false;
    }
    
    // Check work center (with consolidation)
    const consolidatedWC = consolidateWorkCenter(cycle.work_cycles_work_center_rec_name);
    if (consolidatedWC !== workCenter) {
      // Debug logging for specific case
      if (operatorName === 'Courtney Banh' && workCenter === 'Assembly' && routing === 'Lifetime Pouch') {
        console.log(`🔍 Work center mismatch: "${cycle.work_cycles_work_center_rec_name}" consolidated to "${consolidatedWC}" vs expected "${workCenter}"`);
      }
      return false;
    }
    
    // Check routing - handle both production_orders table lookup and direct routing field
    let cycleRouting: string;
    if (cycle.work_production_number && routingMap.has(cycle.work_production_number)) {
      cycleRouting = routingMap.get(cycle.work_production_number)!;
    } else {
      cycleRouting = cycle.work_production_routing_rec_name || 'Unknown';
    }
    
    if (cycleRouting !== routing) {
      // Debug logging for specific case
      if (operatorName === 'Courtney Banh' && workCenter === 'Assembly' && routing === 'Lifetime Pouch') {
        console.log(`🔍 Routing mismatch: "${cycleRouting}" vs expected "${routing}" (production_number: ${cycle.work_production_number})`);
      }
      return false;
    }
    
    return true;
  });
  
  // Debug log after filtering
  if (operatorName === 'Courtney Banh' && workCenter === 'Assembly' && routing === 'Lifetime Pouch') {
    console.log(`🚨 AFTER FILTERING: Found ${filteredCycles.length} matching cycles`);
  }
  
  // STEP 1: Calculate total duration for each MO per work center
  // Only sum durations for the specific work center we're calculating
  const moWorkCenterDurations = new Map<string, number>();
  
  filteredCycles.forEach(cycle => {
    if (!cycle.work_cycles_duration || cycle.work_cycles_duration <= 0) {
      return;
    }
    
    // Only include cycles that have a production quantity (not NULL)
    if (!cycle.work_production_quantity || cycle.work_production_quantity <= 0) {
      return;
    }
    
    // Generate an MO number for cycles without production numbers
    const moNumber = cycle.work_production_number || `CYCLE_${cycle.id}_${cycle.work_cycles_id || 'UNKNOWN'}`;
    const currentTotal = moWorkCenterDurations.get(moNumber) || 0;
    moWorkCenterDurations.set(moNumber, currentTotal + cycle.work_cycles_duration);
  });
  
  // STEP 2: Group by MO using TOTAL MO duration
  const moGroupedMap = new Map<string, MoGroupData>();
  
  filteredCycles.forEach(cycle => {
    if (!cycle.work_cycles_duration || cycle.work_cycles_duration <= 0) {
      return;
    }
    
    // Generate an MO number for cycles without production numbers
    const moNumber = cycle.work_production_number || `CYCLE_${cycle.id}_${cycle.work_cycles_id || 'UNKNOWN'}`;
    
    if (!moGroupedMap.has(moNumber)) {
      // Use work center specific duration for this MO
      const workCenterDuration = moWorkCenterDurations.get(moNumber) || 0;
      
      moGroupedMap.set(moNumber, {
        operatorName,
        workCenter,
        routing,
        moNumber,
        totalDurationSeconds: workCenterDuration, // Use work center specific duration
        moQuantity: 0,
        cycleCount: 0,
        woNumber: cycle.work_cycles_id ? `WO${cycle.work_cycles_id}` : 'N/A',
        workOrderId: cycle.work_id || null,
        productionId: cycle.work_production_id || null, // Add production ID for correct Fulfil link
        createDate: cycle.work_production_create_date || null,
        actualWorkCenter: cycle.work_cycles_work_center_rec_name || workCenter,
        operations: cycle.work_operation_rec_name || workCenter
      });
    }
    
    const group = moGroupedMap.get(moNumber)!;
    group.cycleCount++;
    
    // Use work_production_quantity (total MO quantity from CSV)
    if (group.moQuantity === 0 && cycle.work_production_quantity) {
      group.moQuantity = cycle.work_production_quantity;
    }
  });
  
  const moGroupedData = Array.from(moGroupedMap.values());
  
  // Calculate average UPH
  const validUphValues: number[] = [];
  let debugInfo: string[] = [];
  
  moGroupedData.forEach(moData => {
    if (moData.moQuantity <= 0 || moData.totalDurationSeconds <= 0) return;
    
    const durationHours = moData.totalDurationSeconds / 3600;
    if (durationHours < (2 / 60)) return; // Less than 2 minutes
    
    const uphPerMo = moData.moQuantity / durationHours;
    if (uphPerMo > 500) return;
    
    validUphValues.push(uphPerMo);
    
    // Debug logging for specific case
    if (operatorName === 'Courtney Banh' && workCenter === 'Assembly' && routing === 'Lifetime Pouch') {
      debugInfo.push(`MO ${moData.moNumber}: ${moData.moQuantity} units / ${durationHours.toFixed(2)} hrs = ${uphPerMo.toFixed(2)} UPH`);
    }
  });
  
  const averageUph = validUphValues.length > 0
    ? validUphValues.reduce((sum, uph) => sum + uph, 0) / validUphValues.length
    : 0;
    
  // Log debug info for specific case
  if (debugInfo.length > 0) {
    console.log(`\n🔍 DEBUG getCoreUphDetails for ${operatorName} - ${workCenter} - ${routing}:`);
    debugInfo.forEach(info => console.log(`  - ${info}`));
    console.log(`  Average UPH: ${averageUph.toFixed(2)} from ${validUphValues.length} MOs`);
    console.log(`  Individual UPH values: [${validUphValues.map(v => v.toFixed(2)).join(', ')}]`);
  }
  
  return {
    cycles: filteredCycles,
    moGroupedData,
    averageUph,
    // DEBUG DIAGNOSTICS - Add diagnostic information to response
    __debug: {
      totalCyclesQueried: allCycles.length,
      courtneyBanhCyclesFound: allCycles.filter(c => c.work_cycles_operator_rec_name === 'Courtney Banh').length,
      filteredCyclesCount: filteredCycles.length,
      uniqueOperatorsInQuery: [...new Set(allCycles.map(c => c.work_cycles_operator_rec_name))].slice(0, 10)
    }
  };
}

// Calculate all UPH values from work cycles (used by table-data endpoint)
export async function calculateAllUphFromWorkCycles(): Promise<any[]> {
  console.log('=== CALCULATING ALL UPH FROM WORK CYCLES ===');
  
  // Use the core calculator with no filters to get all UPH values
  const coreResults = await calculateCoreUph({
    bypassDateFilter: true // Get all historical data
  });
  
  // Transform results to match the expected format for table-data endpoint
  const transformedResults = coreResults.map(result => ({
    operatorName: result.operatorName,
    workCenter: result.workCenter,
    productRouting: result.routing,
    operation: result.workCenter,
    uph: result.unitsPerHour,
    observationCount: result.observations,
    totalDurationHours: result.observations, // This is a placeholder
    totalQuantity: Math.round(result.unitsPerHour * result.observations), // Approximate
    dataSource: 'work_cycles'
  }));
  
  console.log(`=== CALCULATED ${transformedResults.length} UPH VALUES ===`);
  
  return transformedResults;
}