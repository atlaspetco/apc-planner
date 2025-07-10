/**
 * UPH calculation using authentic Fulfil API field mapping from production.work/cycles endpoint
 * Uses exact field paths as specified by user for complete data integrity
 */

import { db } from "./db.js";
import { workCycles, historicalUph, operators } from "../shared/schema.js";
import { sql } from "drizzle-orm";

/**
 * Transform work center name according to aggregation rules:
 * - Any work center with "/ Assembly" -> "Assembly"
 * - Keep only Cutting, Assembly, Packaging in frontend
 */
function transformWorkCenter(workCenterName: string): string {
  if (!workCenterName) return 'Unknown';
  
  const name = workCenterName.trim();
  
  // Rule: Any work center that has "/ Assembly" in the name gets aggregated into 'Assembly'
  if (name.includes('/ Assembly')) {
    return 'Assembly';
  }
  
  // Standard consolidation for consistent grouping
  const lowerName = name.toLowerCase();
  if (lowerName.includes('cutting') || lowerName.includes('cut') || lowerName.includes('laser') || lowerName.includes('webbing')) {
    return 'Cutting';
  } else if (lowerName.includes('sewing') || lowerName.includes('assembly') || lowerName.includes('rope') || lowerName.includes('embroidery')) {
    return 'Assembly';
  } else if (lowerName.includes('packaging') || lowerName.includes('pack')) {
    return 'Packaging';
  }
  
  return name; // Keep original if no match
}

export async function calculateUphFromFulfilFields() {
  console.log("Calculating UPH using authentic Fulfil API field mapping...");

  try {
    // Query using exact Fulfil API field paths from production.work/cycles endpoint
    const cyclesResult = await db.execute(sql`
      SELECT 
        work_cycles_operator_rec_name as operator_name,
        work_operation_rec_name as operation_name,
        work_cycles_duration as duration,
        work_cycles_quantity_done as quantity_done,
        work_cycles_operator_write_date as updated_timestamp,
        work_cycles_work_center_rec_name as work_center_name,
        work_production_routing_rec_name as routing_name,
        work_production_number as production_order_number,
        work_id as work_order_id
      FROM work_cycles 
      WHERE work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_operator_rec_name != ''
        AND work_cycles_work_center_rec_name IS NOT NULL
        AND work_cycles_duration > 0
        AND work_cycles_quantity_done > 0
        AND work_production_routing_rec_name IS NOT NULL
    `);
    
    const cycles = cyclesResult.rows;
    console.log(`Found ${cycles.length} complete work cycles with authentic Fulfil field mapping`);

    // Group cycles by operator + transformed work center + routing ONLY (sum ALL operations within work center)
    const groupedCycles = new Map<string, {
      operatorName: string;
      operations: Set<string>;
      transformedWorkCenter: string;
      originalWorkCenters: Set<string>;
      routing: string;
      totalDuration: number;
      totalQuantity: number;
      observations: number;
      latestUpdate: Date | null;
    }>();

    for (const cycle of cycles) {
      const operatorName = cycle.operator_name?.toString() || '';
      const originalWorkCenter = cycle.work_center_name?.toString() || '';
      const transformedWorkCenter = transformWorkCenter(originalWorkCenter);
      const routing = cycle.routing_name?.toString() || '';
      const operationName = cycle.operation_name?.toString() || '';
      
      // CRITICAL FIX: Group by operator + transformed work center + routing ONLY
      // This ensures ALL operations within the same work center are summed together
      const key = `${operatorName}|${transformedWorkCenter}|${routing}`;
      
      if (!groupedCycles.has(key)) {
        groupedCycles.set(key, {
          operatorName,
          operations: new Set(),
          transformedWorkCenter,
          originalWorkCenters: new Set(),
          routing,
          totalDuration: 0,
          totalQuantity: 0,
          observations: 0,
          latestUpdate: null
        });
      }

      const group = groupedCycles.get(key)!;
      
      // Sum ALL durations and quantities across ALL operations in this work center
      group.totalDuration += parseFloat(cycle.duration?.toString() || '0');
      group.totalQuantity += parseFloat(cycle.quantity_done?.toString() || '0');
      group.observations += 1;
      
      // Track all operations and work centers included in this aggregation
      group.operations.add(operationName);
      group.originalWorkCenters.add(originalWorkCenter);
      
      // Track latest update timestamp
      if (cycle.updated_timestamp) {
        const updateDate = new Date(cycle.updated_timestamp.toString());
        if (!group.latestUpdate || updateDate > group.latestUpdate) {
          group.latestUpdate = updateDate;
        }
      }
    }

    console.log(`Grouped into ${groupedCycles.size} operator/work center/routing combinations`);

    // Calculate UPH and store in database
    const uphCalculations: Array<{
      operatorId: number;
      routing: string;
      operation: string;
      operator: string;
      workCenter: string;
      totalQuantity: number;
      totalHours: number;
      unitsPerHour: number;
      observations: number;
      dataSource: string;
    }> = [];

    for (const [key, group] of groupedCycles) {
      const totalHours = group.totalDuration / 3600; // Convert seconds to hours
      
      // Only include groups with meaningful data
      if (totalHours > 0.01 && group.observations >= 1) {
        const unitsPerHour = group.totalQuantity / totalHours;
        
        // Filter for realistic UPH values
        if (unitsPerHour > 0 && unitsPerHour < 500) {
          uphCalculations.push({
            operatorId: 0, // Will be resolved when storing
            routing: group.routing,
            operation: Array.from(group.operations).join(', '), // Show all operations included
            operator: group.operatorName,
            workCenter: group.transformedWorkCenter, // Use transformed work center for consistency
            totalQuantity: Math.round(group.totalQuantity),
            totalHours: Math.round(totalHours * 100) / 100,
            unitsPerHour: Math.round(unitsPerHour * 100) / 100,
            observations: group.observations,
            dataSource: `fulfil-cycles-${new Date().toISOString().split('T')[0]}`
          });
          
          console.log(`${group.operatorName} | ${group.transformedWorkCenter} | ${group.routing}: ${group.totalQuantity} units in ${Math.round(totalHours * 100) / 100}h = ${Math.round(unitsPerHour * 100) / 100} UPH (${group.observations} cycles, operations: ${Array.from(group.operations).join(', ')})`);
        }
      }
    }

    console.log(`Calculated ${uphCalculations.length} realistic UPH values using authentic Fulfil field mapping`);
    
    // Get operator name to ID mapping
    const operatorResults = await db.select({
      id: operators.id,
      name: operators.name
    }).from(operators);
    
    const operatorNameToId = new Map<string, number>();
    operatorResults.forEach(op => {
      operatorNameToId.set(op.name, op.id);
    });
    
    // Clear existing historical UPH data and insert new calculations
    await db.execute(sql`DELETE FROM historical_uph`);
    
    // Insert new UPH calculations with proper operator ID mapping
    for (const calc of uphCalculations) {
      const operatorId = operatorNameToId.get(calc.operator) || null;
      
      await db.execute(sql`
        INSERT INTO historical_uph (
          operator_id, operator, work_center, routing, operation, 
          total_quantity, total_hours, units_per_hour, 
          observations, data_source, last_calculated
        ) VALUES (
          ${operatorId}, ${calc.operator}, ${calc.workCenter}, ${calc.routing}, ${calc.operation},
          ${calc.totalQuantity}, ${calc.totalHours}, ${calc.unitsPerHour},
          ${calc.observations}, ${calc.dataSource}, ${new Date().toISOString()}
        )
      `);
    }

    // Return summary grouped by work center for display
    const summary = uphCalculations.reduce((acc, calc) => {
      if (!acc[calc.workCenter]) {
        acc[calc.workCenter] = {
          totalCalculations: 0,
          avgUph: 0,
          totalObservations: 0
        };
      }
      acc[calc.workCenter].totalCalculations++;
      acc[calc.workCenter].avgUph += calc.unitsPerHour;
      acc[calc.workCenter].totalObservations += calc.observations;
      return acc;
    }, {} as Record<string, { totalCalculations: number, avgUph: number, totalObservations: number }>);

    // Calculate averages
    Object.keys(summary).forEach(wc => {
      summary[wc].avgUph = Math.round((summary[wc].avgUph / summary[wc].totalCalculations) * 100) / 100;
    });

    return {
      success: true,
      calculations: uphCalculations.length,
      summary,
      workCenters: ['Cutting', 'Assembly', 'Packaging'], // Only show these three in frontend
      message: `Calculated ${uphCalculations.length} UPH values using authentic Fulfil API field mapping`
    };

  } catch (error) {
    console.error("Error calculating UPH from Fulfil fields:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      calculations: 0
    };
  }
}