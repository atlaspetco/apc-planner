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
  console.log("🎯 FIXED UPH CALCULATION - Using production.id for authentic MO grouping");
  
  try {
    // Step 1: Extract work cycles grouped by production_id (authentic MO identifier)
    const productionOrdersResult = await db.execute(sql`
      SELECT 
        work_production_id as production_id,
        work_production_number as mo_number,
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center_name,
        work_production_routing_rec_name as routing_name,
        work_production_quantity as mo_quantity,
        SUM(work_cycles_duration) as total_duration_seconds,
        COUNT(*) as cycle_count,
        STRING_AGG(DISTINCT work_operation_rec_name, '|') as operations
      FROM work_cycles 
      WHERE (state = 'done' OR state IS NULL)
        AND work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_work_center_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_cycles_duration > 0
        AND work_production_quantity > 0
        AND work_production_id IS NOT NULL
      GROUP BY 
        work_production_id,
        work_production_number,
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name,
        work_production_routing_rec_name,
        work_production_quantity
      ORDER BY production_id, operator_name, work_center_name
    `);

    const productionOrderData = productionOrdersResult.rows;
    console.log(`✅ Found ${productionOrderData.length} production orders with work cycles`);

    // Step 2: Calculate UPH per production order
    const productionOrderUphs: ProductionOrderUph[] = [];
    
    for (const po of productionOrderData) {
      const productionId = parseInt(po.production_id?.toString() || '0');
      const moNumber = po.mo_number?.toString() || '';
      const operatorName = po.operator_name?.toString() || '';
      const workCenter = transformWorkCenter(po.work_center_name?.toString() || '');
      const routing = po.routing_name?.toString() || '';
      const moQuantity = parseFloat(po.mo_quantity?.toString() || '0');
      const totalDurationSeconds = parseFloat(po.total_duration_seconds?.toString() || '0');
      const cycleCount = parseInt(po.cycle_count?.toString() || '0');
      const operations = (po.operations?.toString() || '').split('|').filter(op => op.trim());

      if (productionId && moQuantity > 0 && totalDurationSeconds > 0) {
        const totalDurationHours = totalDurationSeconds / 3600;
        const uph = moQuantity / totalDurationHours;

        productionOrderUphs.push({
          productionId,
          moNumber,
          operatorName,
          workCenter,
          routing,
          operations,
          moQuantity,
          totalDurationSeconds,
          cycleCount,
          uph
        });
      }
    }

    console.log(`✅ Calculated UPH for ${productionOrderUphs.length} production orders`);

    // Step 3: Aggregate by Operator + Work Center + Routing
    const operatorWorkCenterMap = new Map<string, OperatorWorkCenterUph>();

    for (const poUph of productionOrderUphs) {
      const key = `${poUph.operatorName}|${poUph.workCenter}|${poUph.routing}`;
      
      if (!operatorWorkCenterMap.has(key)) {
        operatorWorkCenterMap.set(key, {
          operatorName: poUph.operatorName,
          workCenter: poUph.workCenter,
          routing: poUph.routing,
          operations: [...poUph.operations],
          moUphValues: [],
          averageUph: 0,
          totalObservations: 0,
          totalHours: 0,
          totalQuantity: 0
        });
      }

      const group = operatorWorkCenterMap.get(key)!;
      group.moUphValues.push(poUph.uph);
      group.totalObservations += poUph.cycleCount;
      group.totalHours += poUph.totalDurationSeconds / 3600;
      group.totalQuantity += poUph.moQuantity;
      
      // Merge operations
      for (const op of poUph.operations) {
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
      productionOrders: productionOrderUphs.length,
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

  const moDetailsResult = await db.execute(sql`
    SELECT 
      work_production_id as production_id,
      work_production_number as mo_number,
      work_production_quantity as mo_quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count,
      STRING_AGG(DISTINCT work_operation_rec_name, ', ') as operations
    FROM work_cycles 
    WHERE work_cycles_operator_rec_name = ${operator}
      AND ${sql.raw(workCenterCondition)}
      AND work_production_routing_rec_name = ${routing}
      AND (state = 'done' OR state IS NULL)
      AND work_cycles_duration > 0
      AND work_production_quantity > 0
    GROUP BY 
      work_production_id,
      work_production_number,
      work_production_quantity
    ORDER BY production_id DESC
  `);

  return moDetailsResult.rows.map(row => {
    const moQuantity = parseFloat(row.mo_quantity?.toString() || '0');
    const totalDurationSeconds = parseFloat(row.total_duration_seconds?.toString() || '0');
    const totalDurationHours = totalDurationSeconds / 3600;
    const uph = moQuantity / totalDurationHours;

    return {
      productionId: row.production_id,
      moNumber: row.mo_number?.toString() || '',
      moQuantity,
      totalDurationHours: parseFloat(totalDurationHours.toFixed(4)),
      cycleCount: parseInt(row.cycle_count?.toString() || '0'),
      operations: row.operations?.toString() || '',
      uph: parseFloat(uph.toFixed(2))
    };
  });
}