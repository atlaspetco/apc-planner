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
  console.log("Calculating UPH directly from work_cycles with proper routing names...");

  try {
    // Calculate UPH directly from work_cycles table to get proper routing names
    const workCyclesResult = await db.execute(sql`
      SELECT 
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center,
        work_production_routing_rec_name as routing,
        work_production_id as production_id,
        work_cycles_id as work_order_id,
        work_cycles_duration,
        work_cycles_quantity_done,
        1 as cycle_count
      FROM work_cycles 
      WHERE work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_operator_rec_name != ''
        AND work_cycles_work_center_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_production_routing_rec_name != ''
        AND work_cycles_duration > 0
        AND work_cycles_quantity_done >= 0
      ORDER BY work_production_id, work_cycles_id
    `);
    
    const workCycles = workCyclesResult.rows;
    console.log(`Found ${workCycles.length} work cycles with proper routing names`);

    // Convert duration from seconds to hours
    function parseDurationToHours(duration: string | number): number {
      if (!duration) return 0;
      const seconds = typeof duration === 'string' ? parseFloat(duration) : duration;
      if (isNaN(seconds)) return 0;
      return seconds / 3600; // Convert seconds to hours
    }

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

    for (const workCycle of workCycles) {
      const operatorName = workCycle.operator_name?.toString() || '';
      const originalWorkCenter = workCycle.work_center?.toString() || '';
      const transformedWorkCenter = transformWorkCenter(originalWorkCenter);
      const routing = workCycle.routing?.toString() || '';
      const productionId = workCycle.production_id?.toString() || '';
      const workOrderId = workCycle.work_order_id?.toString() || '';
      const durationHours = parseDurationToHours(workCycle.work_cycles_duration?.toString() || '');
      const quantity = parseFloat(workCycle.work_cycles_quantity_done?.toString() || '0');
      const cycleCount = 1; // Each row is one cycle
      
      if (!operatorName || !originalWorkCenter || !routing || !workOrderId) {
        continue;
      }
      
      // Calculate UPH for this individual work cycle  
      if (durationHours > 0.01 && quantity > 0) {
        const cycleUph = quantity / durationHours;
        
        // Only include realistic UPH values (filter outliers)
        if (cycleUph > 0 && cycleUph < 500) {
          const key = `${operatorName}|${transformedWorkCenter}|${routing}|${workOrderId}`;
          
          workOrderUphValues.set(key, {
            operatorName,
            transformedWorkCenter,
            routing,
            workOrderId,
            uph: cycleUph,
            quantity,
            durationHours,
            observations: cycleCount,
            moNumber: productionId
          });
          
          console.log(`WO ${workOrderId}: ${operatorName} | ${transformedWorkCenter} | ${routing} = ${Math.round(cycleUph * 100) / 100} UPH (${quantity} units in ${Math.round(durationHours * 100) / 100}h)`);
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