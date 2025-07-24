import { db } from "./db.js";
import { workCycles, productionOrders, operators, uphData } from "../shared/schema.js";
import { eq, or, isNull } from "drizzle-orm";

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
}

// Core work center consolidation logic
export function consolidateWorkCenter(wc: string | null): string | null {
  if (!wc) return null;
  const wcLower = wc.toLowerCase();
  if (wcLower.includes('sewing') || wcLower.includes('rope')) {
    return 'Assembly';
  } else if (wcLower.includes('cutting')) {
    return 'Cutting';
  } else if (wcLower.includes('packaging')) {
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
    if (filters.workCenterFilter === 'Assembly') {
      filteredCycles = filteredCycles.filter(c => {
        const wc = c.work_cycles_work_center_rec_name?.toLowerCase() || '';
        return wc.includes('sewing') || wc.includes('rope');
      });
    } else {
      filteredCycles = filteredCycles.filter(c => {
        const consolidated = consolidateWorkCenter(c.work_cycles_work_center_rec_name);
        return consolidated === filters.workCenterFilter;
      });
    }
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
  
  // STEP 1: Group by Operator + Work Center + Routing + MO using INDIVIDUAL OPERATOR duration
  const moGroupedData = new Map<string, MoGroupData>();
  
  filteredCycles.forEach(cycle => {
    if (!cycle.work_cycles_operator_rec_name || 
        !cycle.work_cycles_work_center_rec_name || 
        !cycle.work_production_number ||
        !cycle.work_cycles_duration ||
        cycle.work_cycles_duration <= 0) {
      return;
    }
    
    const consolidatedWC = consolidateWorkCenter(cycle.work_cycles_work_center_rec_name);
    if (!consolidatedWC) return;
    
    const routing = routingMap.get(cycle.work_production_number) || 
                   cycle.work_production_routing_rec_name || 
                   'Unknown';
                   
    const groupKey = `${cycle.work_cycles_operator_rec_name}|${consolidatedWC}|${routing}|${cycle.work_production_number}`;
    
    if (!moGroupedData.has(groupKey)) {
      moGroupedData.set(groupKey, {
        operatorName: cycle.work_cycles_operator_rec_name,
        workCenter: consolidatedWC,
        routing,
        moNumber: cycle.work_production_number,
        totalDurationSeconds: 0, // Will accumulate individual operator's duration only
        moQuantity: 0,
        cycleCount: 0
      });
      
      // Debug specific case
      if (cycle.work_cycles_operator_rec_name === 'Devin Cann' && 
          consolidatedWC === 'Packaging' && 
          cycle.work_production_number === 'MO94699') {
        console.log(`\n🔍 DEBUG MO ${cycle.work_production_number}: Using individual operator duration for ${cycle.work_cycles_operator_rec_name}`);
      }
    }
    
    const group = moGroupedData.get(groupKey)!;
    group.cycleCount++;
    
    // CRITICAL FIX: Add duration ONLY within the same work center for this operator
    group.totalDurationSeconds += cycle.work_cycles_duration;
    
    // Get MO quantity - CRITICAL: Use production order quantity, not cycle quantity
    const moQuantity = moQuantityMap.get(cycle.work_production_number) || 
                      cycle.work_production_quantity || 
                      0;
    if (moQuantity > 0) {
      group.moQuantity = moQuantity;
    }
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
    
    // CRITICAL FIX: Filter out unrealistic UPH values below 1.0
    const durationHours = moData.totalDurationSeconds / 3600;
    const calculatedUph = moData.moQuantity / durationHours;
    
    // Skip Manufacturing Orders with UPH below 1.0 (indicates data corruption)
    if (calculatedUph < 1.0) {
      console.log(`⚠️ FILTERING OUT unrealistic UPH: ${moData.moNumber} = ${calculatedUph.toFixed(2)} UPH (${moData.moQuantity} units ÷ ${durationHours.toFixed(2)}h)`);
      return;
    }
    
    // Apply realistic filters
    if (durationHours < (2 / 60)) return; // Less than 2 minutes
    
    const uphPerMo = moData.moQuantity / durationHours;
    
    // Debug logging for specific case
    if (moData.operatorName === 'Courtney Banh' && 
        moData.workCenter === 'Assembly' && 
        moData.routing === 'Lifetime Pouch') {
      console.log(`🔍 MO ${moData.moNumber}: Quantity=${moData.moQuantity}, Duration=${durationHours.toFixed(2)}hrs, UPH=${uphPerMo.toFixed(2)}`);
    }
    
    // Apply work center-specific UPH limits
    const getUphLimit = (workCenter: string): number => {
      switch (workCenter.toLowerCase()) {
        case 'assembly': return 100; // Assembly is more manual, limited to 100 UPH
        case 'cutting': return 500;  // Cutting can be much faster with machines
        case 'packaging': return 300; // Packaging can be fast but not as fast as cutting
        default: return 200; // Default conservative limit
      }
    };
    
    const uphLimit = getUphLimit(moData.workCenter);
    if (uphPerMo > uphLimit) {
      console.log(`🚫 EXTREME OUTLIER FILTERED: MO ${moData.moNumber} - ${uphPerMo.toFixed(2)} UPH exceeds ${uphLimit} limit for ${moData.workCenter} (${moData.operatorName}/${moData.workCenter}/${moData.routing})`);
      return;
    }
    
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

    // For groups with multiple values, apply statistical outlier detection
    let finalValues = group.moUphValues;
    
    if (group.moUphValues.length >= 3) {
      const mean = group.moUphValues.reduce((sum, uph) => sum + uph, 0) / group.moUphValues.length;
      const variance = group.moUphValues.reduce((sum, uph) => sum + Math.pow(uph - mean, 2), 0) / group.moUphValues.length;
      const stdDev = Math.sqrt(variance);
      
      // Filter outliers beyond 2 standard deviations
      const filteredValues = group.moUphValues.filter(uph => {
        const isOutlier = Math.abs(uph - mean) > (2 * stdDev);
        if (isOutlier) {
          console.log(`📊 STATISTICAL OUTLIER: ${group.operatorName}/${group.workCenter}/${group.routing} - UPH ${uph.toFixed(2)} (mean: ${mean.toFixed(2)}, stdDev: ${stdDev.toFixed(2)})`);
        }
        return !isOutlier;
      });
      
      // Only use filtered values if we don't remove too many
      if (filteredValues.length >= (group.moUphValues.length * 0.7)) {
        finalValues = filteredValues;
      } else {
        console.log(`⚠️ Too many statistical outliers for ${group.operatorName}/${group.workCenter}/${group.routing}, keeping original data`);
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
  const { eq } = await import("drizzle-orm");
  
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
  // Fetch all necessary data
  const allCycles = await db.select().from(workCycles);
  const allProductionOrders = await db.select().from(productionOrders);
  
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
  
  // Filter cycles for this specific combination
  const filteredCycles = allCycles.filter(cycle => {
    if (!cycle.work_cycles_operator_rec_name || 
        !cycle.work_cycles_work_center_rec_name || 
        !cycle.work_production_number) {
      return false;
    }
    
    // Check operator
    if (cycle.work_cycles_operator_rec_name !== operatorName) return false;
    
    // Check work center (with consolidation)
    const consolidatedWC = consolidateWorkCenter(cycle.work_cycles_work_center_rec_name);
    if (consolidatedWC !== workCenter) return false;
    
    // Check routing
    const cycleRouting = routingMap.get(cycle.work_production_number) || 
                        cycle.work_production_routing_rec_name || 
                        'Unknown';
    if (cycleRouting !== routing) return false;
    
    return true;
  });
  
  // STEP 1: Group by MO using OPERATOR-SPECIFIC work center duration only
  const moGroupedMap = new Map<string, MoGroupData>();
  
  filteredCycles.forEach(cycle => {
    if (!cycle.work_production_number || !cycle.work_cycles_duration || cycle.work_cycles_duration <= 0) {
      return;
    }
    
    const moNumber = cycle.work_production_number;
    
    if (!moGroupedMap.has(moNumber)) {
      moGroupedMap.set(moNumber, {
        operatorName,
        workCenter,
        routing,
        moNumber,
        totalDurationSeconds: 0, // Will accumulate ONLY this operator's work center duration
        moQuantity: 0,
        cycleCount: 0
      });
    }
    
    const group = moGroupedMap.get(moNumber)!;
    group.cycleCount++;
    // CRITICAL FIX: For parallel operations within same work center, use MAX duration, not SUM
    // Operations like "Assembly - Webbing" and "Sewing" happen in parallel, not sequentially
    if (cycle.work_cycles_duration > group.totalDurationSeconds) {
      group.totalDurationSeconds = cycle.work_cycles_duration;
    }
    
    // Get MO quantity
    const moQuantity = moQuantityMap.get(moNumber) || 
                      cycle.work_production_quantity || 
                      0;
    if (moQuantity > 0) {
      group.moQuantity = moQuantity;
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
    
    // CRITICAL FIX: Filter out unrealistic UPH values below 1.0
    if (uphPerMo < 1.0) {
      console.log(`⚠️ FILTERING OUT unrealistic UPH in details: ${moData.moNumber} = ${uphPerMo.toFixed(2)} UPH (${moData.moQuantity} units ÷ ${durationHours.toFixed(2)}h)`);
      return;
    }
    
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
    averageUph
  };
}