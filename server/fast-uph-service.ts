/**
 * Fast UPH Service - Uses pre-calculated UPH table for instant lookups
 * Matches production orders to existing UPH data instead of recalculating
 */

import { db } from "./db.js";
import { historicalUph, productionOrders, operators } from "../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";

interface FastUphLookup {
  operatorId?: number;
  operatorName?: string;
  workCenter: string;
  routing: string;
  operation?: string;
  unitsPerHour: number;
  observations: number;
  totalHours: number;
  totalQuantity: number;
}

/**
 * Fast UPH lookup by production order
 * Matches MO routing to pre-calculated UPH data
 */
export async function getUphForProductionOrder(
  moNumber: string, 
  workCenter: string, 
  operatorId?: number
): Promise<FastUphLookup | null> {
  try {
    // Get production order routing
    const [poResult] = await db
      .select({ 
        routingName: productionOrders.routingName,
        product_code: productionOrders.product_code 
      })
      .from(productionOrders)
      .where(eq(productionOrders.moNumber, moNumber))
      .limit(1);

    if (!poResult) {
      console.log(`No production order found for ${moNumber}`);
      return null;
    }

    const routing = poResult.routingName || getRoutingFromProductCode(poResult.product_code);
    
    if (!routing) {
      console.log(`No routing found for ${moNumber}`);
      return null;
    }

    // Build query conditions
    let conditions = [
      eq(historicalUph.routing, routing),
      eq(historicalUph.workCenter, workCenter)
    ];

    if (operatorId) {
      conditions.push(eq(historicalUph.operatorId, operatorId));
    }

    // Get pre-calculated UPH data
    const uphResults = await db
      .select({
        operatorId: historicalUph.operatorId,
        operator: historicalUph.operator,
        workCenter: historicalUph.workCenter,
        routing: historicalUph.routing,
        operation: historicalUph.operation,
        unitsPerHour: historicalUph.unitsPerHour,
        observations: historicalUph.observations,
        totalHours: historicalUph.totalHours,
        totalQuantity: historicalUph.totalQuantity
      })
      .from(historicalUph)
      .where(and(...conditions))
      .orderBy(sql`${historicalUph.observations} DESC`) // Prefer entries with more observations
      .limit(1);

    if (uphResults.length === 0) {
      console.log(`No UPH data found for routing: ${routing}, workCenter: ${workCenter}`);
      return null;
    }

    const result = uphResults[0];
    return {
      operatorId: result.operatorId || undefined,
      operatorName: result.operator || undefined,
      workCenter: result.workCenter,
      routing: result.routing,
      operation: result.operation || undefined,
      unitsPerHour: result.unitsPerHour,
      observations: result.observations,
      totalHours: result.totalHours,
      totalQuantity: result.totalQuantity
    };

  } catch (error) {
    console.error(`Error getting UPH for ${moNumber}:`, error);
    return null;
  }
}

/**
 * Get all available UPH data for a routing
 */
export async function getUphByRouting(routing: string): Promise<FastUphLookup[]> {
  try {
    const uphResults = await db
      .select({
        operatorId: historicalUph.operatorId,
        operator: historicalUph.operator,
        workCenter: historicalUph.workCenter,
        routing: historicalUph.routing,
        operation: historicalUph.operation,
        unitsPerHour: historicalUph.unitsPerHour,
        observations: historicalUph.observations,
        totalHours: historicalUph.totalHours,
        totalQuantity: historicalUph.totalQuantity
      })
      .from(historicalUph)
      .where(eq(historicalUph.routing, routing))
      .orderBy(sql`${historicalUph.workCenter}, ${historicalUph.observations} DESC`);

    return uphResults.map(result => ({
      operatorId: result.operatorId || undefined,
      operatorName: result.operator || undefined,
      workCenter: result.workCenter,
      routing: result.routing,
      operation: result.operation || undefined,
      unitsPerHour: result.unitsPerHour,
      observations: result.observations,
      totalHours: result.totalHours,
      totalQuantity: result.totalQuantity
    }));

  } catch (error) {
    console.error(`Error getting UPH for routing ${routing}:`, error);
    return [];
  }
}

/**
 * Calculate estimated time for production order using pre-calculated UPH
 */
export async function calculateEstimatedTime(
  moNumber: string,
  quantity: number,
  workCenter: string,
  operatorId?: number
): Promise<number | null> {
  const uphData = await getUphForProductionOrder(moNumber, workCenter, operatorId);
  
  if (!uphData || uphData.unitsPerHour <= 0) {
    console.log(`No UPH data available for ${moNumber} in ${workCenter}`);
    return null;
  }

  const estimatedHours = quantity / uphData.unitsPerHour;
  console.log(`Estimated time for ${moNumber}: ${quantity} units ÷ ${uphData.unitsPerHour} UPH = ${estimatedHours.toFixed(2)} hours`);
  
  return estimatedHours;
}

/**
 * Get routing from product code using existing mapping logic
 */
function getRoutingFromProductCode(productCode: string | null): string | null {
  if (!productCode) return null;
  
  if (productCode.startsWith("LCA-")) return "Lifetime Lite Collar";
  else if (productCode.startsWith("LPL") || productCode === "LPL") return "Lifetime Loop";
  else if (productCode.startsWith("LP-")) return "Lifetime Pouch";
  else if (productCode.startsWith("F0102-") || productCode.includes("X-Pac")) return "Cutting - Fabric";
  else if (productCode.startsWith("BAN-")) return "Lifetime Bandana";
  else if (productCode.startsWith("LHA-")) return "Lifetime Harness";
  else if (productCode.startsWith("LCP-")) return "LCP Custom";
  else if (productCode.startsWith("F3-")) return "Fi Snap";
  else if (productCode.startsWith("PB-")) return "Poop Bags";
  
  return null;
}

/**
 * Get summary statistics from UPH table
 */
export async function getUphSummaryStats(): Promise<{
  totalRoutings: number;
  totalOperators: number;
  totalWorkCenters: number;
  totalObservations: number;
}> {
  try {
    const [stats] = await db.execute(sql`
      SELECT 
        COUNT(DISTINCT routing) as total_routings,
        COUNT(DISTINCT operator_id) as total_operators,
        COUNT(DISTINCT work_center) as total_work_centers,
        SUM(observations) as total_observations
      FROM historical_uph
    `);

    const row = stats.rows[0];
    return {
      totalRoutings: Number(row[0] || 0),
      totalOperators: Number(row[1] || 0),
      totalWorkCenters: Number(row[2] || 0),
      totalObservations: Number(row[3] || 0)
    };
  } catch (error) {
    console.error("Error getting UPH summary stats:", error);
    return {
      totalRoutings: 0,
      totalOperators: 0,
      totalWorkCenters: 0,
      totalObservations: 0
    };
  }
}