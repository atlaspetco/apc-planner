import { sql } from "drizzle-orm";
import { db } from "../server/db.js";
import { workCycles, historicalUph, operators } from "../shared/schema.js";
import { eq } from "drizzle-orm";

interface MoGroupData {
  operatorId: number | null;
  operatorName: string;
  workCenter: string;
  routing: string;
  moNumber: string;
  moQuantity: number;
  totalDurationSeconds: number;
  cycleCount: number;
  operations: Set<string>;
}

interface OperatorUphGroup {
  operatorId: number | null;
  operatorName: string;
  workCenter: string;
  routing: string;
  moUphValues: Array<{
    moNumber: string;
    uph: number;
    moQuantity: number;
    durationHours: number;
  }>;
  operations: Set<string>;
}

/**
 * Transform work center names to standard categories
 */
function transformWorkCenter(workCenter: string): string {
  const wcLower = workCenter.toLowerCase().trim();
  
  // Map variations to standard names
  if (wcLower.includes('sewing') || wcLower.includes('assembly')) {
    return 'Assembly';
  } else if (wcLower.includes('rope')) {
    return 'Assembly'; // Rope also maps to Assembly
  } else if (wcLower.includes('cutting')) {
    return 'Cutting';
  } else if (wcLower.includes('packaging') || wcLower.includes('packing')) {
    return 'Packaging';
  }
  
  // Return original if no mapping found
  return workCenter;
}

/**
 * Calculate accurate UPH following the exact specification:
 * 1. Extract completed Work Cycles (state = Done) for each Operator, grouped by Routing + Work Center
 * 2. For each Work Cycle, retrieve: Operator ID, Production ID (to link MO quantity), Duration in seconds
 * 3. Compute UPH per MO: UPH = MO Quantity / (Total Duration in hours)
 * 4. Average across MOs to get operator-specific UPH per Routing + Work Center combo
 */
export async function calculateAccurateUPH() {
  console.log("🎯 Starting accurate UPH calculation following exact specification...");

  try {
    // Step 1: Extract completed work cycles with all required fields including MO quantity
    const cyclesResult = await db.execute(sql`
      SELECT DISTINCT
        work_cycles_operator_id as operator_id,
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center_name,
        work_production_routing_rec_name as routing_name,
        work_production_number as mo_number,
        work_production_id as production_id,
        work_production_quantity as mo_quantity,  -- CRITICAL: MO quantity, not cycle quantity
        work_cycles_duration as duration_seconds,
        work_operation_rec_name as operation_name,
        work_cycles_id as cycle_id,
        work_id as work_order_id,
        state
      FROM work_cycles 
      WHERE (state = 'done' OR state IS NULL)  -- Include completed cycles and cycles without state
        AND work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_operator_rec_name != ''
        AND work_cycles_work_center_rec_name IS NOT NULL
        AND work_cycles_duration > 0
        AND work_production_quantity > 0  -- MO must have quantity
        AND work_production_routing_rec_name IS NOT NULL
      ORDER BY work_production_number, work_id, work_cycles_id
    `);
    
    const cycles = cyclesResult.rows;
    console.log(`✅ Found ${cycles.length} completed work cycles with MO quantities`);

    // Step 2: Group cycles by Operator + Routing + Work Center + MO
    const moGroups = new Map<string, MoGroupData>();

    for (const cycle of cycles) {
      const operatorId = cycle.operator_id as number || null;
      const operatorName = cycle.operator_name?.toString() || '';
      const workCenter = transformWorkCenter(cycle.work_center_name?.toString() || '');
      const routing = cycle.routing_name?.toString() || '';
      const moNumber = cycle.mo_number?.toString() || '';
      const moQuantity = parseFloat(cycle.mo_quantity?.toString() || '0');
      const durationSeconds = parseFloat(cycle.duration_seconds?.toString() || '0');
      const operation = cycle.operation_name?.toString() || '';
      
      if (!operatorName || !workCenter || !routing || !moNumber || moQuantity <= 0) {
        continue;
      }
      
      // Key: operator + work center + routing + MO
      const key = `${operatorName}|${workCenter}|${routing}|${moNumber}`;
      
      if (!moGroups.has(key)) {
        moGroups.set(key, {
          operatorId,
          operatorName,
          workCenter,
          routing,
          moNumber,
          moQuantity, // Use the MO quantity from production order
          totalDurationSeconds: 0,
          cycleCount: 0,
          operations: new Set()
        });
      }

      const group = moGroups.get(key)!;
      // Sum durations from all work cycles for this MO
      group.totalDurationSeconds += durationSeconds;
      group.cycleCount += 1;
      if (operation) group.operations.add(operation);
    }

    console.log(`📊 Grouped into ${moGroups.size} unique MO combinations`);

    // Step 3: Calculate UPH per MO = MO Quantity / Total Duration in hours
    const operatorGroups = new Map<string, OperatorUphGroup>();

    for (const [key, moGroup] of moGroups) {
      const totalHours = moGroup.totalDurationSeconds / 3600; // Convert to hours
      
      // Skip if insufficient data
      if (totalHours < 0.01 || moGroup.cycleCount === 0) {
        continue;
      }
      
      // Calculate UPH for this MO using MO quantity (not sum of cycle quantities)
      const moUph = moGroup.moQuantity / totalHours;
      
      // Filter out unrealistic UPH values
      if (moUph < 1 || moUph > 500) {
        console.log(`⚠️  Skipping unrealistic UPH: ${moGroup.operatorName} - ${moGroup.moNumber} = ${moUph.toFixed(2)} UPH`);
        continue;
      }
      
      // Group by operator + work center + routing for averaging
      const groupKey = `${moGroup.operatorName}|${moGroup.workCenter}|${moGroup.routing}`;
      
      if (!operatorGroups.has(groupKey)) {
        operatorGroups.set(groupKey, {
          operatorId: moGroup.operatorId,
          operatorName: moGroup.operatorName,
          workCenter: moGroup.workCenter,
          routing: moGroup.routing,
          moUphValues: [],
          operations: new Set()
        });
      }
      
      const group = operatorGroups.get(groupKey)!;
      group.moUphValues.push({
        moNumber: moGroup.moNumber,
        uph: moUph,
        moQuantity: moGroup.moQuantity,
        durationHours: totalHours
      });
      
      // Merge operations
      moGroup.operations.forEach(op => group.operations.add(op));
      
      console.log(`✅ MO ${moGroup.moNumber}: ${moGroup.operatorName} | ${moGroup.workCenter} | ${moGroup.routing} = ${moUph.toFixed(2)} UPH (${moGroup.moQuantity} units in ${totalHours.toFixed(2)}h)`);
    }

    console.log(`\n📈 Created ${operatorGroups.size} operator/work center/routing combinations for averaging`);

    // Step 4: Average UPH across MOs for each operator + routing + work center combination
    const uphCalculations = [];
    
    for (const [key, group] of operatorGroups) {
      if (group.moUphValues.length === 0) continue;
      
      // CRITICAL FIX: Filter out outlier UPH values to prevent inflation
      // Remove MOs with UPH > 100 (unrealistic) or duration < 5 minutes (too short)
      const filteredMoUphValues = group.moUphValues.filter(mo => {
        const isRealistic = mo.uph <= 100 && mo.durationHours >= (5/60); // 5 minutes minimum
        if (!isRealistic) {
          console.log(`⚠️  Filtering outlier: ${group.operatorName} | ${group.workCenter} | ${group.routing} | ${mo.moNumber} = ${mo.uph.toFixed(2)} UPH (${mo.durationHours.toFixed(2)}h)`);
        }
        return isRealistic;
      });
      
      if (filteredMoUphValues.length === 0) {
        console.log(`❌ No valid MOs after outlier filtering for ${group.operatorName} | ${group.workCenter} | ${group.routing}`);
        continue;
      }
      
      // Calculate average UPH across filtered MOs
      const averageUph = filteredMoUphValues.reduce((sum, mo) => sum + mo.uph, 0) / filteredMoUphValues.length;
      
      console.log(`📊 ${group.operatorName} | ${group.workCenter} | ${group.routing}: Filtered ${group.moUphValues.length - filteredMoUphValues.length} outliers, using ${filteredMoUphValues.length} MOs`);
      
      // Update group to use filtered values
      group.moUphValues = filteredMoUphValues;
      
      // Calculate totals for context using filtered values
      const totalQuantity = filteredMoUphValues.reduce((sum, mo) => sum + mo.moQuantity, 0);
      const totalHours = filteredMoUphValues.reduce((sum, mo) => sum + mo.durationHours, 0);
      const moCount = filteredMoUphValues.length;
      
      uphCalculations.push({
        operatorId: group.operatorId,
        operatorName: group.operatorName,
        workCenter: group.workCenter,
        routing: group.routing,
        operation: Array.from(group.operations).join(', '),
        averageUph: Math.round(averageUph * 100) / 100,
        moCount,
        totalQuantity,
        totalHours: Math.round(totalHours * 100) / 100,
        individualMos: group.moUphValues.map(mo => ({
          moNumber: mo.moNumber,
          uph: Math.round(mo.uph * 100) / 100,
          quantity: mo.moQuantity,
          hours: Math.round(mo.durationHours * 100) / 100
        }))
      });
      
      console.log(`📊 ${group.operatorName} | ${group.workCenter} | ${group.routing}: Average UPH = ${averageUph.toFixed(2)} (from ${moCount} filtered MOs)`);
    }

    console.log(`\n✅ Calculated ${uphCalculations.length} averaged UPH values`);

    // Clear existing UPH data from historical table
    await db.delete(historicalUph);
    console.log("🗑️  Cleared existing historical UPH data");

    // Get operator name-to-ID mapping
    const allOperators = await db.select().from(operators);
    const operatorNameToId = new Map<string, number>();
    allOperators.forEach(op => operatorNameToId.set(op.name, op.id));

    // Insert new UPH calculations into historical table
    let inserted = 0;
    for (const calc of uphCalculations) {
      const operatorId = calc.operatorId || operatorNameToId.get(calc.operatorName);
      
      if (operatorId) {
        await db.insert(historicalUph).values({
          operatorId: operatorId,
          routing: calc.routing,
          operation: calc.operation,
          operator: calc.operatorName,
          workCenter: calc.workCenter,
          totalQuantity: calc.totalQuantity,
          totalHours: calc.totalHours,
          unitsPerHour: calc.averageUph,
          observations: calc.moCount,
          dataSource: 'accurate_mo_calculation',
          lastCalculated: new Date()
        });
        inserted++;
      }
    }

    console.log(`\n🎉 Successfully inserted ${inserted} accurate UPH calculations`);
    
    return {
      success: true,
      totalCycles: cycles.length,
      moGroups: moGroups.size,
      operatorGroups: operatorGroups.size,
      calculations: uphCalculations,
      inserted
    };

  } catch (error) {
    console.error("❌ Error calculating accurate UPH:", error);
    throw error;
  }
}

/**
 * Get MO-level details for a specific operator/workCenter/routing combination
 * This shows each MO as a single row with aggregated data, not individual work cycles
 */
export async function getAccurateMoDetails(
  operatorName: string,
  workCenter: string,
  routing: string
): Promise<{
  moLevelData: any[];
  averageUph: number;
  totalQuantity: number;
  totalDurationHours: number;
  totalCycles: number;
  moCount: number;
}> {
  console.log(`📊 Getting MO-level details for ${operatorName} | ${workCenter} | ${routing}`);

  try {
    // Fetch work cycles for this specific combination
    // Don't filter by work center in SQL - we'll transform and filter in code
    const cyclesResult = await db.execute(sql`
      SELECT DISTINCT
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center_name,
        work_production_routing_rec_name as routing_name,
        work_production_number as mo_number,
        work_production_quantity as mo_quantity,
        work_cycles_duration as duration_seconds,
        work_operation_rec_name as operation_name,
        updated_at as mo_date,
        work_cycles_id as cycle_id
      FROM work_cycles 
      WHERE (state = 'done' OR state IS NULL)  -- Include completed cycles and cycles without state
        AND work_cycles_operator_rec_name = ${operatorName}
        AND work_production_routing_rec_name = ${routing}
        AND work_cycles_duration > 0
        AND work_production_quantity > 0
      ORDER BY work_production_number, work_cycles_id
    `);
    
    const cycles = cyclesResult.rows;
    console.log(`Found ${cycles.length} work cycles`);

    // Group by MO and aggregate data
    const moGroups = new Map<string, {
      moNumber: string;
      moQuantity: number;
      totalDurationSeconds: number;
      operations: Set<string>;
      cycleCount: number;
      moDate: Date | null;
    }>();

    for (const cycle of cycles) {
      const originalWorkCenter = cycle.work_center_name?.toString() || '';
      const cycleWorkCenter = transformWorkCenter(originalWorkCenter);
      
      // Skip if work center doesn't match (after transformation)
      if (cycleWorkCenter !== workCenter) {
        console.log(`  Skipping cycle with work center "${originalWorkCenter}" (transformed to "${cycleWorkCenter}") - looking for "${workCenter}"`);
        continue;
      }

      const moNumber = cycle.mo_number?.toString() || '';
      const moQuantity = parseFloat(cycle.mo_quantity?.toString() || '0');
      const durationSeconds = parseFloat(cycle.duration_seconds?.toString() || '0');
      const operation = cycle.operation_name?.toString() || '';
      const moDate = cycle.mo_date ? new Date(cycle.mo_date as string) : null;
      
      if (!moNumber || moQuantity <= 0) continue;
      
      if (!moGroups.has(moNumber)) {
        moGroups.set(moNumber, {
          moNumber,
          moQuantity,
          totalDurationSeconds: 0,
          operations: new Set(),
          cycleCount: 0,
          moDate
        });
      }
      
      const group = moGroups.get(moNumber)!;
      group.totalDurationSeconds += durationSeconds;
      group.cycleCount++;
      if (operation) group.operations.add(operation);
    }

    // Convert to MO-level data array
    const moLevelData = [];
    let totalQuantity = 0;
    let totalDurationHours = 0;
    let totalCycles = 0;
    const uphValues: number[] = [];

    for (const [moNumber, moData] of moGroups) {
      const durationHours = moData.totalDurationSeconds / 3600;
      
      const moUph = moData.moQuantity / durationHours;
      
      // CRITICAL FIX: Apply same outlier filtering as main calculation
      // Remove MOs with UPH > 100 (unrealistic) or duration < 5 minutes (too short)
      const isRealistic = moUph <= 100 && durationHours >= (5/60);
      if (!isRealistic) {
        console.log(`⚠️  Filtering outlier MO ${moNumber}: ${moUph.toFixed(2)} UPH (${durationHours.toFixed(2)}h)`);
        continue;
      }
      
      uphValues.push(moUph);
      totalQuantity += moData.moQuantity;
      totalDurationHours += durationHours;
      totalCycles += moData.cycleCount;

      moLevelData.push({
        id: moNumber,
        moNumber: moNumber,
        woNumber: `Combined (${moData.cycleCount} cycles)`,
        workCenter: workCenter,
        operation: Array.from(moData.operations).join(', ') || 'Combined Operations',
        quantity: moData.moQuantity,
        durationHours: Math.round(durationHours * 100) / 100,
        uph: Math.round(moUph * 100) / 100,
        date: moData.moDate,
        cycleCount: moData.cycleCount
      });
    }

    // Calculate average UPH
    const averageUph = uphValues.length > 0
      ? uphValues.reduce((sum, uph) => sum + uph, 0) / uphValues.length
      : 0;

    console.log(`✅ Processed ${moLevelData.length} MOs with average UPH: ${averageUph.toFixed(2)}`);

    return {
      moLevelData,
      averageUph: Math.round(averageUph * 100) / 100,
      totalQuantity,
      totalDurationHours: Math.round(totalDurationHours * 100) / 100,
      totalCycles,
      moCount: moLevelData.length
    };

  } catch (error) {
    console.error("❌ Error getting MO details:", error);
    throw error;
  }
}

// Execute if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  calculateAccurateUPH()
    .then(result => {
      console.log("\n📊 Calculation Summary:", {
        success: result.success,
        totalCycles: result.totalCycles,
        moGroups: result.moGroups,
        calculations: result.calculations.length,
        inserted: result.inserted
      });
      process.exit(0);
    })
    .catch(error => {
      console.error("Failed:", error);
      process.exit(1);
    });
}