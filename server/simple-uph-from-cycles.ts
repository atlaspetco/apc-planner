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
    // Get all work cycles with complete data
    const cycles = await db
      .select({
        operator: workCycles.work_cycles_operator_rec_name,
        workCenter: workCycles.work_cycles_work_center_rec_name,
        operation: workCycles.work_operation_rec_name,
        routing: workCycles.work_production_routing_rec_name,
        duration: workCycles.work_cycles_duration,
        quantityDone: workCycles.work_cycles_quantity_done
      })
      .from(workCycles)
      .where(sql`
        ${workCycles.work_cycles_operator_rec_name} IS NOT NULL 
        AND ${workCycles.work_cycles_work_center_rec_name} IS NOT NULL 
        AND ${workCycles.work_operation_rec_name} IS NOT NULL
        AND ${workCycles.work_production_routing_rec_name} IS NOT NULL
        AND ${workCycles.work_cycles_duration} > 0
      `);

    console.log(`Found ${cycles.length} complete work cycles for UPH calculation`);

    // Group by operator + work center + routing for aggregation
    const groupedCycles = new Map<string, {
      operator: string;
      workCenter: string;
      routing: string;
      operation: string;
      totalDuration: number;
      totalQuantity: number;
      observations: number;
    }>();

    for (const cycle of cycles) {
      // Clean work center name (handle "Sewing / Assembly" -> "Sewing")
      let cleanWorkCenter = cycle.workCenter?.trim() || "";
      if (cleanWorkCenter.includes(" / ")) {
        cleanWorkCenter = cleanWorkCenter.split(" / ")[0].trim();
      }

      const key = `${cycle.operator}|${cleanWorkCenter}|${cycle.routing}`;
      
      if (!groupedCycles.has(key)) {
        groupedCycles.set(key, {
          operator: cycle.operator!,
          workCenter: cleanWorkCenter,
          routing: cycle.routing!,
          operation: cycle.operation!,
          totalDuration: 0,
          totalQuantity: 0,
          observations: 0
        });
      }

      const group = groupedCycles.get(key)!;
      group.totalDuration += cycle.duration || 0;
      group.totalQuantity += cycle.quantityDone || 1; // Default to 1 if quantity is null/0
      group.observations += 1;
    }

    console.log(`Grouped into ${groupedCycles.size} operator/work center/routing combinations`);

    // Calculate UPH for each group and store in database
    const uphCalculations: Array<{
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
      await db.insert(historicalUph).values(uphCalculations);
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