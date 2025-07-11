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
  console.log("Calculating UPH using work_order_durations aggregated data...");

  try {
    // Use the existing work_order_durations table that properly aggregates cycles by work order
    const workOrdersResult = await db.execute(sql`
      SELECT 
        operator_name,
        work_center,
        routing_name as routing,
        production_number as mo_number,
        work_order_id,
        total_duration_hours,
        total_quantity_done,
        cycle_count
      FROM work_order_durations 
      WHERE operator_name IS NOT NULL 
        AND operator_name != ''
        AND work_center IS NOT NULL
        AND total_duration_hours > 0
        AND total_quantity_done > 0
        AND routing_name IS NOT NULL
      ORDER BY production_number, work_order_id
    `);
    
    const workOrders = workOrdersResult.rows;
    console.log(`Found ${workOrders.length} aggregated work orders from work_order_durations table`);

    // STEP 1: Calculate UPH for each individual work order
    const workOrderUphValues = new Map<string, {
      operatorName: string;
      transformedWorkCenter: string;
      routing: string;
      workOrderId: string;
      uph: number;
      quantity: number;
      durationHours: number;
      observations: number;
      moNumber: string;
    }>();

    for (const workOrder of workOrders) {
      const operatorName = workOrder.operator_name?.toString() || '';
      const originalWorkCenter = workOrder.work_center?.toString() || '';
      const transformedWorkCenter = transformWorkCenter(originalWorkCenter);
      const routing = workOrder.routing?.toString() || '';
      const moNumber = workOrder.mo_number?.toString() || '';
      const workOrderId = workOrder.work_order_id?.toString() || '';
      const durationHours = parseFloat(workOrder.total_duration_hours?.toString() || '0');
      const quantity = parseFloat(workOrder.total_quantity_done?.toString() || '0');
      const cycleCount = parseInt(workOrder.cycle_count?.toString() || '0');
      
      if (!operatorName || !originalWorkCenter || !routing || !workOrderId) {
        continue;
      }
      
      // Calculate UPH for this individual work order
      if (durationHours > 0.01 && quantity > 0) {
        const workOrderUph = quantity / durationHours;
        
        // Only include realistic UPH values (filter outliers)
        if (workOrderUph > 0 && workOrderUph < 500) {
          const key = `${operatorName}|${transformedWorkCenter}|${routing}|${workOrderId}`;
          
          workOrderUphValues.set(key, {
            operatorName,
            transformedWorkCenter,
            routing,
            workOrderId,
            uph: workOrderUph,
            quantity,
            durationHours,
            observations: cycleCount,
            moNumber
          });
          
          console.log(`WO ${workOrderId}: ${operatorName} | ${transformedWorkCenter} | ${routing} = ${Math.round(workOrderUph * 100) / 100} UPH (${quantity} units in ${Math.round(durationHours * 100) / 100}h)`);
        }
      }
    }

    console.log(`Step 1: Calculated UPH for ${workOrderUphValues.size} individual work orders`);

    // STEP 2: Group work orders by operator+work center+routing and average their UPH values
    const operatorWorkCenterRoutingGroups = new Map<string, {
      operatorName: string;
      transformedWorkCenter: string;
      routing: string;
      workOrderUphValues: Array<{uph: number, workOrderId: string, quantity: number, durationHours: number, observations: number, moNumber: string}>;
      totalObservations: number;
    }>();

    for (const [key, woData] of workOrderUphValues) {
      const groupKey = `${woData.operatorName}|${woData.transformedWorkCenter}|${woData.routing}`;
      
      if (!operatorWorkCenterRoutingGroups.has(groupKey)) {
        operatorWorkCenterRoutingGroups.set(groupKey, {
          operatorName: woData.operatorName,
          transformedWorkCenter: woData.transformedWorkCenter,
          routing: woData.routing,
          workOrderUphValues: [],
          totalObservations: 0
        });
      }
      
      const group = operatorWorkCenterRoutingGroups.get(groupKey)!;
      group.workOrderUphValues.push({
        uph: woData.uph,
        workOrderId: woData.workOrderId,
        quantity: woData.quantity,
        durationHours: woData.durationHours,
        observations: woData.observations,
        moNumber: woData.moNumber
      });
      group.totalObservations += woData.observations;
    }

    console.log(`Step 2: Created ${operatorWorkCenterRoutingGroups.size} operator/work center/routing combinations for averaging`);

    // STEP 3: Calculate average UPH for each operator+work center+routing combination
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

    for (const [key, group] of operatorWorkCenterRoutingGroups) {
      if (group.workOrderUphValues.length > 0) {
        // Calculate average UPH across all individual work orders (CORRECT METHOD)
        const averageUph = group.workOrderUphValues.reduce((sum, wo) => sum + wo.uph, 0) / group.workOrderUphValues.length;
        
        // Calculate actual totals from individual work orders
        const totalQuantity = group.workOrderUphValues.reduce((sum, wo) => sum + wo.quantity, 0);
        const totalHours = group.workOrderUphValues.reduce((sum, wo) => sum + wo.durationHours, 0);
        
        uphCalculations.push({
          operatorId: 0, // Will be resolved when storing
          routing: group.routing,
          operation: 'Various', // Individual work orders may have different operations
          operator: group.operatorName,
          workCenter: group.transformedWorkCenter,
          totalQuantity: Math.round(totalQuantity),
          totalHours: Math.round(totalHours * 100) / 100,
          unitsPerHour: Math.round(averageUph * 100) / 100,
          observations: group.totalObservations,
          dataSource: `fulfil-cycles-wo-averaged-${new Date().toISOString().split('T')[0]}`
        });
        
        const woSample = group.workOrderUphValues.slice(0, 5).map(wo => `${wo.workOrderId}=${Math.round(wo.uph * 100) / 100}`).join(', ');
        const woExtra = group.workOrderUphValues.length > 5 ? `...+${group.workOrderUphValues.length - 5} more` : '';
        console.log(`AVERAGED: ${group.operatorName} | ${group.transformedWorkCenter} | ${group.routing}: ${Math.round(averageUph * 100) / 100} UPH (averaged from ${group.workOrderUphValues.length} WOs: ${woSample}${woExtra})`);
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