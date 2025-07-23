import { sql } from "drizzle-orm";
import { db } from "./db.js";
import { historicalUph, operators } from "../shared/schema.js";

/**
 * FIXED UPH CALCULATION - Uses production.id as the authentic MO identifier
 * 
 * The fundamental fix: Group by work_production_id (not mo_number) to get
 * authentic Manufacturing Order totals from the Fulfil API response.
 */

interface ProductionOrderUph {
  productionId: number;
  moNumber: string;
  operatorName: string;
  workCenter: string;
  routing: string;
  operations: string[];
  moQuantity: number;
  totalDurationSeconds: number;
  cycleCount: number;
  uph: number;
}

interface OperatorWorkCenterUph {
  operatorName: string;
  workCenter: string;
  routing: string;
  operations: string[];
  moUphValues: number[];
  averageUph: number;
  totalObservations: number;
  totalHours: number;
  totalQuantity: number;
}

function transformWorkCenter(workCenter: string): string {
  const wcLower = workCenter.toLowerCase().trim();
  
  if (wcLower.includes('sewing') || wcLower.includes('assembly')) {
    return 'Assembly';
  } else if (wcLower.includes('rope')) {
    return 'Assembly';
  } else if (wcLower.includes('cutting')) {
    return 'Cutting';
  } else if (wcLower.includes('packaging') || wcLower.includes('packing')) {
    return 'Packaging';
  }
  
  return workCenter;
}

export async function calculateFixedUPH() {
  console.log("🎯 FIXED UPH CALCULATION - Using individual work cycle calculations for authentic performance");
  
  try {
    // Step 1: Extract individual work cycles for accurate performance metrics
    const workCyclesResult = await db.execute(sql`
      SELECT 
        work_production_id as production_id,
        work_production_number as mo_number,
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center_name,
        work_production_routing_rec_name as routing_name,
        work_cycles_quantity_done as cycle_quantity,
        work_cycles_duration as total_duration_seconds,
        work_operation_rec_name as operations,
        work_cycles_id as cycle_id
      FROM work_cycles 
      WHERE (state = 'done' OR state IS NULL)
        AND work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_work_center_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_cycles_duration >= 30  -- Minimum 30 seconds to filter corrupted data
        AND work_cycles_quantity_done > 0
        AND work_production_id IS NOT NULL
      ORDER BY production_id, operator_name, work_center_name
    `);

    const workCycleData = workCyclesResult.rows;
    console.log(`✅ Found ${workCycleData.length} individual work cycles`);

    // Step 2: Calculate UPH per individual work cycle
    const rawWorkCycleUphs: ProductionOrderUph[] = [];
    
    for (const cycle of workCycleData) {
      const productionId = parseInt(cycle.production_id?.toString() || '0');
      const moNumber = cycle.mo_number?.toString() || '';
      const operatorName = cycle.operator_name?.toString() || '';
      const workCenter = transformWorkCenter(cycle.work_center_name?.toString() || '');
      const routing = cycle.routing_name?.toString() || '';
      const cycleQuantity = parseFloat(cycle.cycle_quantity?.toString() || '0');
      const totalDurationSeconds = parseFloat(cycle.total_duration_seconds?.toString() || '0');
      const operations = [cycle.operations?.toString() || ''].filter(op => op.trim());

      if (productionId && cycleQuantity > 0 && totalDurationSeconds >= 30) {
        const totalDurationHours = totalDurationSeconds / 3600;
        const uph = cycleQuantity / totalDurationHours;

        rawWorkCycleUphs.push({
          productionId,
          moNumber,
          operatorName,
          workCenter,
          routing,
          operations,
          moQuantity: cycleQuantity, // Using work cycle quantity for authentic performance
          totalDurationSeconds,
          cycleCount: 1, // Each entry represents one work cycle
          uph
        });
      }
    }

    // Step 2.5: Apply statistical outlier detection by operator+workCenter+routing groups
    const workCycleUphs: ProductionOrderUph[] = [];
    const groupedByKey = new Map<string, ProductionOrderUph[]>();
    
    // Group by operator+workCenter+routing for outlier detection
    for (const cycle of rawWorkCycleUphs) {
      const key = `${cycle.operatorName}|${cycle.workCenter}|${cycle.routing}`;
      if (!groupedByKey.has(key)) {
        groupedByKey.set(key, []);
      }
      groupedByKey.get(key)!.push(cycle);
    }

    // Apply outlier filtering within each group
    for (const [key, group] of groupedByKey.entries()) {
      if (group.length >= 3) { // Need at least 3 points for meaningful stats
        const uphValues = group.map(po => po.uph);
        const mean = uphValues.reduce((sum, uph) => sum + uph, 0) / uphValues.length;
        const variance = uphValues.reduce((sum, uph) => sum + Math.pow(uph - mean, 2), 0) / uphValues.length;
        const stdDev = Math.sqrt(variance);
        const lowerBound = mean - (2 * stdDev);
        const upperBound = mean + (2 * stdDev);

        const filteredGroup = group.filter(cycle => {
          // Apply absolute UPH bounds first
          const absoluteMaxUph = 1000;
          const isWithinAbsoluteBounds = cycle.uph <= absoluteMaxUph && cycle.uph >= 0.1;
          
          // Apply statistical bounds
          const isWithinStatisticalBounds = cycle.uph >= lowerBound && cycle.uph <= upperBound;
          
          const isValid = isWithinAbsoluteBounds && isWithinStatisticalBounds;
          
          if (!isValid) {
            if (!isWithinAbsoluteBounds) {
              console.log(`🚫 Filtering corrupted data cycle: ${cycle.moNumber} (${cycle.operatorName}/${cycle.workCenter}/${cycle.routing}) with ${cycle.uph.toFixed(2)} UPH`);
            } else {
              console.log(`🚫 Filtering statistical outlier cycle: ${cycle.moNumber} (${cycle.operatorName}/${cycle.workCenter}/${cycle.routing}) with ${cycle.uph.toFixed(2)} UPH`);
            }
          }
          return isValid;
        });

        console.log(`📊 ${key}: filtered ${group.length - filteredGroup.length} outliers from ${group.length} cycles`);
        workCycleUphs.push(...filteredGroup);
      } else {
        // Keep all if too few data points for meaningful statistics
        workCycleUphs.push(...group);
      }
    }

    console.log(`✅ Calculated UPH for ${workCycleUphs.length} work cycles`);

    // Step 3: Aggregate by Operator + Work Center + Routing
    const operatorWorkCenterMap = new Map<string, OperatorWorkCenterUph>();

    for (const cycleUph of workCycleUphs) {
      const key = `${cycleUph.operatorName}|${cycleUph.workCenter}|${cycleUph.routing}`;
      
      if (!operatorWorkCenterMap.has(key)) {
        operatorWorkCenterMap.set(key, {
          operatorName: cycleUph.operatorName,
          workCenter: cycleUph.workCenter,
          routing: cycleUph.routing,
          operations: [...cycleUph.operations],
          moUphValues: [],
          averageUph: 0,
          totalObservations: 0,
          totalHours: 0,
          totalQuantity: 0
        });
      }

      const group = operatorWorkCenterMap.get(key)!;
      group.moUphValues.push(cycleUph.uph);
      group.totalObservations += cycleUph.cycleCount;
      group.totalHours += cycleUph.totalDurationSeconds / 3600;
      group.totalQuantity += cycleUph.moQuantity;
      
      // Merge operations
      for (const op of cycleUph.operations) {
        if (!group.operations.includes(op)) {
          group.operations.push(op);
        }
      }
    }

    // Step 4: Get operator name-to-ID mapping
    const allOperators = await db.select().from(operators);
    const operatorNameToId = new Map<string, number>();
    allOperators.forEach(op => operatorNameToId.set(op.name, op.id));

    // Step 5: Calculate averages and save to historical UPH table
    console.log("💾 Clearing and rebuilding historical UPH table...");
    await db.delete(historicalUph);

    const uphRecords = [];
    for (const [key, group] of operatorWorkCenterMap.entries()) {
      if (group.moUphValues.length > 0) {
        // Calculate average UPH across all MOs
        group.averageUph = group.moUphValues.reduce((sum, uph) => sum + uph, 0) / group.moUphValues.length;

        const operatorId = operatorNameToId.get(group.operatorName);
        if (operatorId) {
          uphRecords.push({
            operatorId,
            operator: group.operatorName,
            workCenter: group.workCenter,
            routing: group.routing,
            operation: group.operations.join(', '),
            totalQuantity: Math.round(group.totalQuantity),
            totalHours: parseFloat(group.totalHours.toFixed(4)),
            unitsPerHour: parseFloat(group.averageUph.toFixed(2)),
            observations: group.totalObservations,
            dataSource: 'production_id_grouped'
          });
        }
      }
    }

    // Insert records in batches
    if (uphRecords.length > 0) {
      for (const record of uphRecords) {
        await db.insert(historicalUph).values(record);
      }
    }

    console.log(`✅ Successfully rebuilt UPH table with ${uphRecords.length} accurate calculations`);
    
    // Return summary
    return {
      workCycles: workCycleUphs.length,
      operatorWorkCenterCombinations: uphRecords.length,
      totalObservations: uphRecords.reduce((sum, r) => sum + r.observations, 0),
      averageUph: uphRecords.reduce((sum, r) => sum + r.unitsPerHour, 0) / uphRecords.length
    };

  } catch (error) {
    console.error("❌ Error in fixed UPH calculation:", error);
    throw error;
  }
}

export async function getAccurateMoDetails(operator: string, workCenter: string, routing: string) {
  console.log(`🔍 Getting MO details for ${operator} + ${workCenter} + ${routing}`);
  
  // Handle Assembly work center mapping - includes Rope and Sewing
  let workCenterCondition = '';
  if (workCenter === 'Assembly') {
    workCenterCondition = `(work_cycles_work_center_rec_name LIKE '%Assembly%' OR 
                           work_cycles_work_center_rec_name LIKE '%Sewing%' OR 
                           work_cycles_work_center_rec_name LIKE '%Rope%')`;
  } else {
    workCenterCondition = `work_cycles_work_center_rec_name LIKE '%' || '${workCenter}' || '%'`;
  }

  // CORRECT APPROACH: Use individual work cycle calculations for authentic performance metrics
  // Each work cycle represents actual operator performance without artificial aggregation
  const rawCyclesResult = await db.execute(sql`
    SELECT 
      work_production_id as production_id,
      work_production_number as mo_number,
      work_cycles_quantity_done as cycle_quantity,
      work_production_create_date as create_date,
      work_cycles_work_center_rec_name as actual_work_center,
      work_cycles_duration as total_duration_seconds,
      1 as cycle_count,
      work_operation_rec_name as operations,
      work_cycles_id::text as work_order_ids,
      (work_cycles_quantity_done / (work_cycles_duration / 3600.0)) as calculated_uph
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = ${operator}
      AND ${sql.raw(workCenterCondition)}
      AND work_production_routing_rec_name = ${routing}
      AND (state = 'done' OR state IS NULL)
      AND work_cycles_duration >= 30  -- Minimum 30 seconds to filter only corrupted data
      AND work_cycles_quantity_done > 0
    ORDER BY work_production_id DESC
  `);

  // Step 1: Calculate mean and standard deviation for outlier detection
  const uphValues = rawCyclesResult.rows.map(row => 
    parseFloat(row.calculated_uph?.toString() || '0')
  );
  
  if (uphValues.length === 0) {
    return [];
  }

  const mean = uphValues.reduce((sum, uph) => sum + uph, 0) / uphValues.length;
  const variance = uphValues.reduce((sum, uph) => sum + Math.pow(uph - mean, 2), 0) / uphValues.length;
  const stdDev = Math.sqrt(variance);
  const lowerBound = mean - (2 * stdDev);
  const upperBound = mean + (2 * stdDev);

  console.log(`📊 Outlier detection: mean=${mean.toFixed(2)}, stdDev=${stdDev.toFixed(2)}, bounds=[${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`);

  // Step 2: Filter out outliers using both statistical and absolute bounds
  const moDetailsResult = {
    rows: rawCyclesResult.rows.filter(row => {
      const uph = parseFloat(row.calculated_uph?.toString() || '0');
      
      // Apply absolute UPH cap to filter corrupted data like 24000 UPH
      const absoluteMaxUph = 1000; // No legitimate manufacturing should exceed 1000 UPH
      const isWithinAbsoluteBounds = uph <= absoluteMaxUph && uph >= 0.1;
      
      // Apply statistical outlier detection for more refined filtering
      const isWithinStatisticalBounds = uph >= lowerBound && uph <= upperBound;
      
      const isValid = isWithinAbsoluteBounds && isWithinStatisticalBounds;
      
      if (!isValid) {
        if (!isWithinAbsoluteBounds) {
          console.log(`🚫 Filtering corrupted data: MO${row.mo_number} with ${uph.toFixed(2)} UPH (absolute bounds violation)`);
        } else {
          console.log(`🚫 Filtering statistical outlier: MO${row.mo_number} with ${uph.toFixed(2)} UPH (outside 2σ bounds)`);
        }
      }
      return isValid;
    })
  };

  const moDetails = moDetailsResult.rows.map(row => {
    const cycleQuantity = parseFloat(row.cycle_quantity?.toString() || '0');
    const totalDurationSeconds = parseFloat(row.total_duration_seconds?.toString() || '0');
    const totalDurationHours = totalDurationSeconds / 3600;
    const uph = cycleQuantity / totalDurationHours;

    return {
      productionId: row.production_id,
      moNumber: row.mo_number?.toString() || '',
      woNumber: row.work_order_ids?.toString() || 'N/A',
      createDate: row.create_date?.toString() || null,
      actualWorkCenter: row.actual_work_center?.toString() || '',
      moQuantity: cycleQuantity, // Using individual work cycle quantity for authentic performance
      totalDurationHours: parseFloat(totalDurationHours.toFixed(4)),
      cycleCount: parseInt(row.cycle_count?.toString() || '0'),
      operations: row.operations?.toString() || '',
      uph: parseFloat(uph.toFixed(2))
    };
  });

  return moDetails;
}