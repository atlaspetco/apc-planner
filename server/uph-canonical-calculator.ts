import { db } from "./db.js";
import { workCycles, productionOrders, uphData, operators } from "../shared/schema.js";
import { eq, and, gte, sql } from "drizzle-orm";

interface WorkCycleData {
  work_cycles_id: string;
  work_production_number: string; // MO number
  work_cycles_operator_rec_name: string;
  work_cycles_work_center_rec_name: string;
  work_production_routing_rec_name: string;
  work_operation_rec_name: string;
  work_cycles_duration: number; // in seconds
  work_production_create_date: Date;
  work_id: string; // Work Order ID
}

interface MOData {
  moNumber: string;
  quantity: number;
}

/**
 * Canonical UPH Calculator following the exact specification:
 * 1. Gather all completed cycles
 * 2. Sum durations by WO (Work Order)
 * 3. Sum WO durations by Work Center per MO
 * 4. Calculate UPH per MO
 * 5. Map to categories and average
 * 6. Store historical averages
 */
export async function calculateCanonicalUph(windowDays: number = 30) {
  console.log(`\n=== CANONICAL UPH CALCULATOR STARTED (${windowDays} days) ===`);
  
  try {
    // Step 1 - Gather Cycles
    let whereCondition;
    if (windowDays > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - windowDays);
      whereCondition = and(
        gte(workCycles.work_production_create_date, cutoffDate),
        sql`${workCycles.work_cycles_duration} > 0`
      );
    } else {
      // No date filtering if windowDays is 0
      whereCondition = sql`${workCycles.work_cycles_duration} > 0`;
    }
    
    const cycles = await db
      .select({
        work_cycles_id: workCycles.work_cycles_id,
        work_production_number: workCycles.work_production_number,
        work_cycles_operator_rec_name: workCycles.work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name: workCycles.work_cycles_work_center_rec_name,
        work_production_routing_rec_name: workCycles.work_production_routing_rec_name,
        work_operation_rec_name: workCycles.work_operation_rec_name,
        work_cycles_duration: workCycles.work_cycles_duration,
        work_production_create_date: workCycles.work_production_create_date,
        work_id: workCycles.work_id,
      })
      .from(workCycles)
      .where(whereCondition);

    console.log(`Loaded ${cycles.length} work cycles from last ${windowDays} days`);

    // Get production order quantities
    const moQuantities = new Map<string, number>();
    const productionOrdersData = await db
      .select({
        moNumber: productionOrders.moNumber,
        quantity: productionOrders.quantity,
      })
      .from(productionOrders);
    
    productionOrdersData.forEach(po => {
      if (po.moNumber && po.quantity) {
        moQuantities.set(po.moNumber, po.quantity);
      }
    });

    console.log(`Loaded ${moQuantities.size} production order quantities`);

    // Step 2 - WO Duration
    // Group by: Routing + Operation + Work Center + Operator + WO
    const woDurations = new Map<string, number>();
    const woDetails = new Map<string, any>();
    
    cycles.forEach(cycle => {
      const woKey = `${cycle.work_production_routing_rec_name}|${cycle.work_operation_rec_name}|${cycle.work_cycles_work_center_rec_name}|${cycle.work_cycles_operator_rec_name}|${cycle.work_id}`;
      const currentDuration = woDurations.get(woKey) || 0;
      woDurations.set(woKey, currentDuration + cycle.work_cycles_duration);
      
      // Store details for later use
      woDetails.set(woKey, {
        moNumber: cycle.work_production_number,
        operator: cycle.work_cycles_operator_rec_name,
        workCenter: cycle.work_cycles_work_center_rec_name,
        routing: cycle.work_production_routing_rec_name,
        operation: cycle.work_operation_rec_name,
      });
    });

    console.log(`Calculated durations for ${woDurations.size} work orders`);

    // Step 3 - WC Duration per MO
    // Group by: MO + Work Center + Operator
    const moWcDurations = new Map<string, number>();
    const moWcDetails = new Map<string, any>();
    
    woDurations.forEach((duration, woKey) => {
      const details = woDetails.get(woKey);
      const moWcKey = `${details.moNumber}|${details.workCenter}|${details.operator}`;
      
      const currentDuration = moWcDurations.get(moWcKey) || 0;
      moWcDurations.set(moWcKey, currentDuration + duration);
      
      // Store details
      moWcDetails.set(moWcKey, {
        moNumber: details.moNumber,
        operator: details.operator,
        workCenter: details.workCenter,
        routing: details.routing,
      });
    });

    console.log(`Aggregated to ${moWcDurations.size} MO/WorkCenter combinations`);

    // Step 4 - MO-level UPH
    const moUphValues = new Map<string, number[]>(); // Key: operator|workCenter|routing
    
    moWcDurations.forEach((durationSeconds, moWcKey) => {
      const details = moWcDetails.get(moWcKey);
      const moQuantity = moQuantities.get(details.moNumber);
      
      if (!moQuantity || moQuantity === 0) {
        return; // Skip if no quantity found
      }
      
      const durationHours = durationSeconds / 3600;
      if (durationHours === 0) {
        return; // Skip if no duration
      }
      
      // Filter out anomalies - durations less than 1 minute or more than 24 hours
      if (durationSeconds < 60 || durationSeconds > 86400) {
        return; // Skip anomalous durations
      }
      
      const uphMo = moQuantity / durationHours;
      
      // Group by operator|workCenter|routing for averaging
      const groupKey = `${details.operator}|${details.workCenter}|${details.routing}`;
      const currentValues = moUphValues.get(groupKey) || [];
      currentValues.push(uphMo);
      moUphValues.set(groupKey, currentValues);
    });

    console.log(`Calculated UPH for ${moUphValues.size} operator/workCenter/routing combinations`);

    // Step 5 - Category Roll-up
    const categoryMapping: Record<string, string> = {
      'Cutting': 'Cutting',
      'Cutting - Webbing': 'Cutting',
      'Cutting - Fabric': 'Cutting',
      'Cutting - Rope': 'Cutting',
      'Assembly': 'Assembly',
      'Sewing': 'Assembly',
      'Rope': 'Assembly',
      'Sewing / Assembly': 'Assembly',
      'Rope / Assembly': 'Assembly',
      'Packaging': 'Packaging',
    };

    // Clear existing data
    await db.delete(uphData);

    // Step 6 - Historical Average & Cache
    const results: any[] = [];
    
    moUphValues.forEach((uphValues, groupKey) => {
      const [operator, workCenter, routing] = groupKey.split('|');
      
      // Map to category
      const category = categoryMapping[workCenter] || workCenter;
      
      // Average the UPH values
      const avgUph = uphValues.reduce((sum, val) => sum + val, 0) / uphValues.length;
      
      // Skip unrealistic values
      if (avgUph > 1000) {
        console.log(`Skipping unrealistic UPH: ${operator} - ${workCenter} - ${routing}: ${avgUph.toFixed(2)}`);
        return;
      }
      
      results.push({
        operatorName: operator,
        workCenter: category,
        operation: 'Unknown', // Default value for operation
        productRouting: routing,
        uph: parseFloat(avgUph.toFixed(2)),
        observationCount: uphValues.length,
        dataSource: 'work_cycles',
        windowDays,
        totalQuantity: 0, // Not relevant for averaged values
        totalDurationHours: 0, // Not relevant for averaged values
      });
    });

    // Save to database
    if (results.length > 0) {
      await db.insert(uphData).values(results);
    }

    console.log(`✅ Saved ${results.length} UPH calculations to database`);
    console.log(`=== CANONICAL UPH CALCULATOR COMPLETE ===\n`);

    return {
      success: true,
      calculatedCount: results.length,
      windowDays,
    };
    
  } catch (error) {
    console.error("Error in canonical UPH calculation:", error);
    throw error;
  }
}

// Export function to get UPH details for transparency
export async function getCanonicalUphDetails(
  operatorName: string,
  workCenter: string,
  productRouting: string
) {
  // This would show the individual MO calculations that went into the average
  // Implementation would be similar to above but return the detailed breakdown
  return {
    operator: operatorName,
    workCenter,
    routing: productRouting,
    moCalculations: [], // Would contain individual MO UPH values
  };
}