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
  daysBack: number = 30
): Promise<UphCalculationResult[]> {
  try {
    // Use core calculator for consistency
    const { calculateCoreUph } = await import("./uph-core-calculator.js");
    const coreResults = await calculateCoreUph({ operatorFilter, workCenterFilter, routingFilter });
    
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

    // Build query with explicit columns
    const whereConditions = [];
    
    // Apply filters
    if (operatorFilter) {
      whereConditions.push(eq(workCycles.work_cycles_operator_rec_name, operatorFilter));
    }
    
    if (workCenterFilter) {
      if (workCenterFilter === 'Assembly') {
        // Assembly includes Sewing and Rope work centers
        whereConditions.push(sql`(
          ${workCycles.work_cycles_work_center_rec_name} = 'Sewing' OR 
          ${workCycles.work_cycles_work_center_rec_name} = 'Rope' OR 
          ${workCycles.work_cycles_work_center_rec_name} = 'Sewing / Assembly' OR 
          ${workCycles.work_cycles_work_center_rec_name} = 'Rope / Assembly'
        )`);
      } else {
        whereConditions.push(eq(workCycles.work_cycles_work_center_rec_name, workCenterFilter));
      }
    }
    
    if (routingFilter) {
      whereConditions.push(eq(workCycles.work_production_routing_rec_name, routingFilter));
    }
    
    // Fetch all cycles with explicit columns
    const cycles = whereConditions.length > 0
      ? await db.select().from(workCycles).where(and(...whereConditions))
      : await db.select().from(workCycles);

    // Get all unique MO numbers from cycles
    const uniqueMONumbers = [...new Set(cycles.map(c => c.work_production_number).filter(Boolean))];
    
    // Fetch MO quantities from production_orders table
    const moQuantityMap = new Map<string, number>();
    
    if (uniqueMONumbers.length > 0) {
      const moData = await db.select({
        moNumber: productionOrders.moNumber,
        quantity: productionOrders.quantity
      })
      .from(productionOrders)
      .where(sql`mo_number IN (${sql.join(uniqueMONumbers.map(mo => sql`${mo}`), sql`, `)})`);
      
      moData.forEach(mo => {
        if (mo.quantity) {
          moQuantityMap.set(mo.moNumber, mo.quantity);
        }
      });
    }

    // Group cycles by Operator + Work Center + Routing + MO
    const groupedData = new Map<string, {
      cycles: typeof cycles;
      totalDurationSeconds: number;
      moQuantity: number;
    }>();

    cycles.forEach(cycle => {
      if (!cycle.work_cycles_operator_rec_name || 
          !cycle.work_cycles_work_center_rec_name || 
          !cycle.work_production_routing_rec_name ||
          !cycle.work_production_number) {
        return;
      }

      // Consolidate work centers
      let consolidatedWorkCenter = cycle.work_cycles_work_center_rec_name;
      const wcLower = consolidatedWorkCenter.toLowerCase();
      if (wcLower.includes('sewing') || wcLower.includes('rope')) {
        consolidatedWorkCenter = 'Assembly';
      } else if (wcLower.includes('cutting')) {
        consolidatedWorkCenter = 'Cutting';
      } else if (wcLower.includes('packaging')) {
        consolidatedWorkCenter = 'Packaging';
      }

      // Create grouping key: Operator|WorkCenter|Routing|Operation|MO
      const operation = cycle.work_operation_rec_name || 'Unknown Operation';
      const groupKey = `${cycle.work_cycles_operator_rec_name}|${consolidatedWorkCenter}|${cycle.work_production_routing_rec_name}|${operation}|${cycle.work_production_number}`;
      
      if (!groupedData.has(groupKey)) {
        groupedData.set(groupKey, {
          cycles: [],
          totalDurationSeconds: 0,
          moQuantity: 0
        });
      }

      const group = groupedData.get(groupKey)!;
      group.cycles.push(cycle);
      group.totalDurationSeconds += cycle.work_cycles_duration || 0;
      
      // Get MO quantity from production orders table if available
      const moNumber = cycle.work_production_number;
      if (moNumber && moQuantityMap.has(moNumber)) {
        group.moQuantity = moQuantityMap.get(moNumber)!;
      } else if (cycle.work_production_quantity) {
        // Use production quantity from work cycle if available
        group.moQuantity = cycle.work_production_quantity;
      }
      // NOTE: Never sum work_cycles_quantity_done - this is a critical error!
    });

    // Calculate UPH per MO and group by Operator + Work Center + Routing + Operation
    const uphByOperatorWorkCenterRoutingOperation = new Map<string, {
      operatorName: string;
      workCenter: string;
      routing: string;
      operation: string;
      moUphValues: { moNumber: string; uph: number; quantity: number; durationHours: number }[];
    }>();

    groupedData.forEach((data, groupKey) => {
      const [operatorName, workCenter, routing, operation, moNumber] = groupKey.split('|');
      
      // Convert duration to hours
      const durationHours = data.totalDurationSeconds / 3600;
      
      // Apply realistic filters
      if (durationHours < (2 / 60)) { // Less than 2 minutes
        return;
      }
      
      // Calculate UPH for this MO
      const uphPerMo = data.moQuantity / durationHours;
      
      // Apply UPH upper limit filter
      if (uphPerMo > 500) {
        return;
      }

      // Group by Operator + Work Center + Routing + Operation for averaging
      const averageKey = `${operatorName}|${workCenter}|${routing}|${operation}`;
      
      if (!uphByOperatorWorkCenterRoutingOperation.has(averageKey)) {
        uphByOperatorWorkCenterRoutingOperation.set(averageKey, {
          operatorName,
          workCenter,
          routing,
          operation,
          moUphValues: []
        });
      }

      uphByOperatorWorkCenterRoutingOperation.get(averageKey)!.moUphValues.push({
        moNumber,
        uph: uphPerMo,
        quantity: data.moQuantity,
        durationHours
      });
    });

    // Calculate average UPH per Operator + Work Center + Routing + Operation
    const results: UphCalculationResult[] = [];
    
    uphByOperatorWorkCenterRoutingOperation.forEach(data => {
      if (data.moUphValues.length === 0) return;
      
      // Calculate average UPH across all MOs
      const totalUph = data.moUphValues.reduce((sum, mo) => sum + mo.uph, 0);
      const averageUph = totalUph / data.moUphValues.length;
      
      results.push({
        operatorName: data.operatorName,
        workCenter: data.workCenter,
        routing: data.routing,
        operation: data.operation,
        averageUph: averageUph,
        observationCount: data.moUphValues.length,
        moDetails: data.moUphValues.sort((a, b) => b.uph - a.uph) // Sort by UPH descending
      });
    });

    // Sort results by routing, then operator name
    return results.sort((a, b) => {
      const routingCompare = a.routing.localeCompare(b.routing);
      if (routingCompare !== 0) return routingCompare;
      return a.operatorName.localeCompare(b.operatorName);
    });

  } catch (error) {
    console.error('Error in unified UPH calculation:', error);
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