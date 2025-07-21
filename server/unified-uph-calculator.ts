import { db } from "./db.js";
import { workCycles, operators, productionOrders } from "../shared/schema.js";
import { eq, and, sql, or, desc } from "drizzle-orm";

export interface UphCalculationResult {
  operatorName: string;
  workCenter: string;
  routing: string;
  operation: string; // Added operation field
  averageUph: number;
  observationCount: number;
  moDetails: {
    moNumber: string;
    uph: number;
    quantity: number;
    durationHours: number;
  }[];
}

/**
 * Core UPH Calculation Logic - Single Source of Truth
 * 
 * This function implements the exact calculation methodology:
 * 1. Group work cycles by Operator, Work Center, Routing, and MO
 * 2. Consolidate related work centers (Rope + Sewing → Assembly)
 * 3. Sum durations and use MO quantity (not work cycle quantity)
 * 4. Calculate UPH per MO, then average across MOs
 * 5. Apply realistic filters (< 500 UPH, duration > 2 minutes)
 */
export async function calculateUnifiedUph(
  operatorFilter?: string,
  workCenterFilter?: string,
  routingFilter?: string,
  daysBack: number = 30,
  bypassDateFilter: boolean = false
): Promise<UphCalculationResult[]> {
  try {
    // Use core calculator for consistency
    const { calculateCoreUph } = await import("./uph-core-calculator.js");
    const coreResults = await calculateCoreUph({ 
      operatorFilter, 
      workCenterFilter, 
      routingFilter,
      bypassDateFilter 
    });
    
    // Transform core results to match this interface's expected output
    return coreResults.map(result => ({
      operatorName: result.operatorName,
      workCenter: result.workCenter,
      routing: result.routing,
      operation: 'Combined Operations', // Core calculator groups all operations
      averageUph: result.unitsPerHour,
      observationCount: result.observations,
      moDetails: result.moUphValues.map((uph, index) => ({
        moNumber: `MO-${index}`, // MO details not preserved in core calculator
        uph,
        quantity: 0, // Not available in aggregated data
        durationHours: 0 // Not available in aggregated data
      }))
    }));
  } catch (error) {
    console.error("Error in calculateUnifiedUph:", error);
    throw error;
  }
}

/**
 * Get UPH calculation details for transparency modal
 * Shows individual work cycles and MO-level calculations
 */
export async function getUphCalculationDetails(
  operatorName: string,
  workCenter: string,
  routing: string
): Promise<{
  cycles: any[];
  summary: {
    totalCycles: number;
    totalMOs: number;
    averageUph: number;
    moBreakdown: {
      moNumber: string;
      quantity: number;
      totalDurationHours: number;
      uph: number;
      cycleCount: number;
    }[];
  };
}> {
  try {
    // Use core calculator for consistency
    const { getCoreUphDetails } = await import("./uph-core-calculator.js");
    const result = await getCoreUphDetails(operatorName, workCenter, routing);
    
    // Format the cycles from core calculator
    const formattedCycles = result.cycles.map(cycle => {
      // Extract operation from work_operation_rec_name (format: "Operation Name | Operator | Work Center")
      let operation = 'N/A';
      if (cycle.work_operation_rec_name) {
        const operationParts = cycle.work_operation_rec_name.split(' | ');
        if (operationParts.length > 0) {
          operation = operationParts[0];
        }
      }

      // Extract WO number from work_rec_name if available
      let woNumber = null;
      if (cycle.work_rec_name) {
        const woParts = cycle.work_rec_name.split(' | ');
        if (woParts.length > 0 && woParts[0].startsWith('WO')) {
          woNumber = woParts[0];
        }
      }

      return {
        id: cycle.id,
        moNumber: cycle.work_production_number || 'N/A',
        woNumber: woNumber || `WO${cycle.work_id || cycle.id}`,
        workCenter: cycle.work_cycles_work_center_rec_name || 'N/A',
        operation,
        quantity: cycle.work_production_quantity || cycle.work_cycles_quantity_done || 0,
        durationSeconds: cycle.work_cycles_duration || 0,
        durationHours: (cycle.work_cycles_duration || 0) / 3600,
        effectiveDate: cycle.work_cycles_operator_write_date,
        createdAt: cycle.createdAt
      };
    });

    // Calculate MO breakdown from grouped data
    const moBreakdown = result.moGroupedData.map(moData => ({
      moNumber: moData.moNumber,
      quantity: moData.moQuantity,
      totalDurationHours: moData.totalDurationSeconds / 3600,
      uph: moData.moQuantity && moData.totalDurationSeconds > 0 
        ? moData.moQuantity / (moData.totalDurationSeconds / 3600) 
        : 0,
      cycleCount: moData.cycleCount
    }));

    return {
      cycles: formattedCycles,
      summary: {
        totalCycles: formattedCycles.length,
        totalMOs: moBreakdown.length,
        averageUph: result.averageUph,
        moBreakdown
      }
    };

  } catch (error) {
    console.error('Error getting UPH calculation details:', error);
    throw error;
  }
}