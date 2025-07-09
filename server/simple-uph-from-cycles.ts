/**
 * Simple UPH calculation using existing work_cycles table data
 * No API calls needed - all data is already in the database
 */

import { db } from "./db.js";
import { workCycles, historicalUph } from "../shared/schema.js";
import { sql } from "drizzle-orm";

export async function calculateUphFromExistingCycles() {
  console.log("Calculating UPH from existing work cycles data...");

  try {
    // Get all work cycles with complete data using raw SQL to avoid field mapping issues
    const cyclesResult = await db.execute(sql`
      SELECT 
        work_cycles_operator_rec_name as operator,
        work_cycles_operator_id as operator_id,
        work_cycles_work_center_rec_name as work_center,
        work_center_id,
        work_operation_rec_name as operation,
        work_production_routing_rec_name as routing,
        work_cycles_duration as duration,
        work_cycles_quantity_done as quantity_done
      FROM work_cycles 
      WHERE work_cycles_operator_rec_name IS NOT NULL 
        AND work_cycles_work_center_rec_name IS NOT NULL 
        AND work_operation_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_cycles_duration > 0
    `);
    
    const cycles = cyclesResult.rows;
    console.log(`Found ${cycles.length} complete work cycles for UPH calculation`);

    // Group by operator ID + work center ID + routing ID for aggregation (use IDs for consistency)
    const groupedCycles = new Map<string, {
      operatorId: number;
      operator: string;
      workCenterId: number;
      workCenter: string;
      routingId: number;
      routing: string;
      operation: string;
      totalDuration: number;
      totalQuantity: number;
      observations: number;
    }>();

    for (const cycle of cycles) {
      // Clean work center name (handle "Sewing / Assembly" -> "Sewing")
      let cleanWorkCenter = cycle.work_center?.trim() || "";
      if (cleanWorkCenter.includes(" / ")) {
        cleanWorkCenter = cleanWorkCenter.split(" / ")[0].trim();
      }

      // Use operator name + work center + routing for grouping
      const key = `${cycle.operator}|${cleanWorkCenter}|${cycle.routing}`;
      
      if (!groupedCycles.has(key)) {
        groupedCycles.set(key, {
          operatorId: cycle.operator_id || null,
          operator: cycle.operator!,
          workCenterId: cycle.work_center_id || null,
          workCenter: cleanWorkCenter,
          routingId: null,
          routing: cycle.routing!,
          operation: cycle.operation!,
          totalDuration: 0,
          totalQuantity: 0,
          observations: 0
        });
      }

      const group = groupedCycles.get(key)!;
      group.totalDuration += cycle.duration || 0;
      group.totalQuantity += cycle.quantity_done || 1; // Default to 1 if quantity is null/0
      group.observations += 1;
    }

    console.log(`Grouped into ${groupedCycles.size} operator/work center/routing combinations`);

    // Calculate UPH for each group and store in database
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
      
      if (totalHours > 0.01 && group.observations >= 2) { // Minimum thresholds
        const uph = group.totalQuantity / totalHours;
        
        // Filter for realistic UPH values
        if (uph >= 1 && uph <= 500) {
          uphCalculations.push({
            operatorId: group.operatorId,
            routing: group.routing,
            operation: group.operation,
            operator: group.operator,
            workCenter: group.workCenter,
            totalQuantity: group.totalQuantity,
            totalHours: totalHours,
            unitsPerHour: Math.round(uph * 100) / 100, // Round to 2 decimal places
            observations: group.observations,
            dataSource: "work_cycles_table"
          });
        }
      }
    }

    console.log(`Calculated ${uphCalculations.length} valid UPH entries`);

    // Clear existing historical UPH data and insert new calculations
    await db.delete(historicalUph);
    
    if (uphCalculations.length > 0) {
      // Map to database schema with operatorId field
      const dbInsertValues = uphCalculations.map(calc => ({
        operatorId: calc.operatorId,
        routing: calc.routing,
        operation: calc.operation,
        operator: calc.operator,
        workCenter: calc.workCenter,
        totalQuantity: calc.totalQuantity,
        totalHours: calc.totalHours,
        unitsPerHour: calc.unitsPerHour,
        observations: calc.observations,
        dataSource: calc.dataSource
      }));
      
      await db.insert(historicalUph).values(dbInsertValues);
    }

    return {
      success: true,
      totalCycles: cycles.length,
      groupedCombinations: groupedCycles.size,
      validUphCalculations: uphCalculations.length,
      message: `Successfully calculated UPH from ${cycles.length} work cycles`
    };

  } catch (error) {
    console.error("Error calculating UPH from cycles:", error);
    throw error;
  }
}