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
    // Calculate date filter
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Build query with base conditions
    let query = db.select().from(workCycles);
    
    // Apply filters
    if (operatorFilter || workCenterFilter || routingFilter) {
      const whereConditions = [];
      
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
      
      query = query.where(and(...whereConditions));
    }
    
    // Fetch all cycles without date filter for now (to avoid SQL syntax error)
    const cycles = await query;

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
      } else {
        // Fallback: Use the max quantity from work cycles if production order quantity not available
        // This is not ideal but necessary when production_orders table is empty
        if ((cycle.work_cycles_quantity_done || 0) > group.moQuantity) {
          group.moQuantity = cycle.work_cycles_quantity_done || 0;
        }
      }
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
    // Calculate UPH for this specific combination
    const results = await calculateUnifiedUph(operatorName, workCenter, routing);
    
    if (results.length === 0) {
      return {
        cycles: [],
        summary: {
          totalCycles: 0,
          totalMOs: 0,
          averageUph: 0,
          moBreakdown: []
        }
      };
    }

    const result = results[0]; // Should only be one result for specific combination
    
    // Fetch the actual work cycles for display
    let cycles;
    
    if (workCenter === 'Assembly') {
      cycles = await db
        .select()
        .from(workCycles)
        .where(
          and(
            eq(workCycles.work_cycles_operator_rec_name, operatorName),
            eq(workCycles.work_production_routing_rec_name, routing),
            or(
              eq(workCycles.work_cycles_work_center_rec_name, 'Sewing'),
              eq(workCycles.work_cycles_work_center_rec_name, 'Rope'),
              eq(workCycles.work_cycles_work_center_rec_name, 'Sewing / Assembly'),
              eq(workCycles.work_cycles_work_center_rec_name, 'Rope / Assembly')
            )
          )
        )
        .orderBy(desc(workCycles.createdAt));
    } else {
      cycles = await db
        .select()
        .from(workCycles)
        .where(
          and(
            eq(workCycles.work_cycles_operator_rec_name, operatorName),
            eq(workCycles.work_production_routing_rec_name, routing),
            eq(workCycles.work_cycles_work_center_rec_name, workCenter)
          )
        )
        .orderBy(desc(workCycles.createdAt));
    }

    // Format cycles for display
    const formattedCycles = cycles.map(cycle => ({
      id: cycle.id,
      moNumber: cycle.work_production_number,
      workCenter: cycle.work_cycles_work_center_rec_name,
      quantity: cycle.work_cycles_quantity_done,
      durationSeconds: cycle.work_cycles_duration,
      durationHours: (cycle.work_cycles_duration || 0) / 3600,
      createdAt: cycle.createdAt
    }));

    // Calculate total cycles across all MOs
    const totalCycles = formattedCycles.length;

    return {
      cycles: formattedCycles,
      summary: {
        totalCycles,
        totalMOs: result.moDetails.length,
        averageUph: result.averageUph,
        moBreakdown: result.moDetails.map(mo => {
          const moCycles = formattedCycles.filter(c => c.moNumber === mo.moNumber);
          return {
            moNumber: mo.moNumber,
            quantity: mo.quantity,
            totalDurationHours: mo.durationHours,
            uph: mo.uph,
            cycleCount: moCycles.length
          };
        })
      }
    };

  } catch (error) {
    console.error('Error getting UPH calculation details:', error);
    throw error;
  }
}