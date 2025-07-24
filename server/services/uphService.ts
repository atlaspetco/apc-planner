/**
 * Standardized UPH Service
 * Implements MO-first UPH calculation keyed on (product_name, work_center_category, operator_id)
 * Supports rolling windows (7, 30, 180 days)
 */

import { db } from "../db.js";
import { workCycles, productionOrders, workOrders } from "../../shared/schema.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { mapWorkCenterToCategory, type WorkCenterCategory } from "../utils/categoryMap.js";

// In-memory cache as fallback
const memoryCache = new Map<string, { data: any; expires: number }>();

export interface UphCalculationParams {
  productName?: string;
  workCenterCategory?: WorkCenterCategory;
  operatorId?: number;
  windowDays?: number; // 7, 30, or 180
}

export interface MoUphResult {
  productName: string;
  workCenterCategory: WorkCenterCategory;
  operatorId: number;
  operatorName: string;
  moId: string;
  moNumber: string;
  quantity: number;
  totalDurationHours: number;
  uphValue: number;
  cycleCount: number;
  windowDays: number;
}

export interface AggregatedUphResult {
  productName: string;
  workCenterCategory: WorkCenterCategory;
  operatorId: number;
  operatorName: string;
  averageUph: number;
  moCount: number;
  totalObservations: number;
  windowDays: number;
  dataAvailable: boolean;
  message?: string;
}

/**
 * Calculate UPH using MO-first approach
 * 1. Filter work cycles by state='done' and date window
 * 2. Join to production orders to get product and quantity
 * 3. Group by MO, calculate UPH per MO
 * 4. Average across MOs for final UPH
 */
export async function calculateStandardizedUph(
  params: UphCalculationParams = {}
): Promise<AggregatedUphResult[]> {
  const { productName, workCenterCategory, operatorId, windowDays = 30 } = params;
  
  // Validate window days
  const validWindows = [7, 30, 180];
  const window = validWindows.includes(windowDays) ? windowDays : 30;
  
  // Check cache first
  const cacheKey = getCacheKey(productName, workCenterCategory, operatorId, window);
  const cached = await getFromCache(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    // Calculate date threshold
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - window);
    
    // Step 1: Get all work cycles within window (no state filter since all are NULL)
    const cyclesQuery = db
      .select({
        cycleId: workCycles.work_cycles_id,
        operatorId: workCycles.work_cycles_operator_id,
        operatorName: workCycles.work_cycles_operator_rec_name,
        workCenterName: workCycles.work_cycles_work_center_rec_name,
        duration: workCycles.work_cycles_duration,
        quantityDone: workCycles.work_cycles_quantity_done,
        startDate: workCycles.work_cycles_operator_write_date, // Using write date as cycle date
        productionOrderNumber: workCycles.work_production_number,
        workOrderId: workCycles.work_id,
        // Use work_production_quantity from work_cycles (all data is in CSV)
        moQuantity: workCycles.work_production_quantity,
        productName: workCycles.work_production_routing_rec_name, // Using routing as product name
        moId: workCycles.work_production_id,
        moNumber: workCycles.work_production_number,
      })
      .from(workCycles)
      .where(
        and(
          gte(workCycles.work_cycles_operator_write_date, dateThreshold),
          // Only include cycles with valid data
          sql`${workCycles.work_cycles_duration} > 0`,
          sql`${workCycles.work_cycles_operator_id} IS NOT NULL`,
          sql`${workCycles.work_production_quantity} IS NOT NULL`
        )
      );
    
    const allCycles = await cyclesQuery;
    
    if (allCycles.length === 0) {
      // Return empty array when no data found
      return [];
    }
    
    // Step 2: Group cycles by MO + category + operator
    const moGroups = new Map<string, {
      productName: string;
      workCenterCategory: WorkCenterCategory;
      operatorId: number;
      operatorName: string;
      moId: string;
      moNumber: string;
      moQuantity: number;
      totalDurationSeconds: number;
      cycleCount: number;
    }>();
    
    for (const cycle of allCycles) {
      // Skip invalid cycles
      if (!cycle.workCenterName || !cycle.operatorId || !cycle.productName) {
        continue;
      }
      
      // Map work center to category
      const category = mapWorkCenterToCategory(cycle.workCenterName);
      if (!category) {
        continue; // Skip unmapped work centers
      }
      
      // Apply filters
      if (productName && cycle.productName !== productName) continue;
      if (workCenterCategory && category !== workCenterCategory) continue;
      if (operatorId && cycle.operatorId !== operatorId) continue;
      
      // Create group key
      const key = `${cycle.moNumber}|${category}|${cycle.operatorId}`;
      
      if (!moGroups.has(key)) {
        moGroups.set(key, {
          productName: cycle.productName,
          workCenterCategory: category,
          operatorId: cycle.operatorId,
          operatorName: cycle.operatorName || 'Unknown',
          moId: cycle.moId?.toString() || cycle.moNumber || '',
          moNumber: cycle.moNumber || '',
          moQuantity: cycle.moQuantity || 0,
          totalDurationSeconds: 0,
          cycleCount: 0
        });
      }
      
      const group = moGroups.get(key)!;
      group.totalDurationSeconds += cycle.duration || 0;
      group.cycleCount += 1;
    }
    
    // Step 3: Calculate UPH for each MO
    const moUphResults: MoUphResult[] = [];
    
    for (const [key, group] of moGroups) {
      if (group.totalDurationSeconds > 0 && group.moQuantity > 0) {
        const totalHours = group.totalDurationSeconds / 3600;
        const uphValue = group.moQuantity / totalHours;
        
        // Filter out unrealistic UPH values
        if (uphValue > 0 && uphValue < 500) {
          moUphResults.push({
            productName: group.productName,
            workCenterCategory: group.workCenterCategory,
            operatorId: group.operatorId,
            operatorName: group.operatorName,
            moId: group.moId,
            moNumber: group.moNumber,
            quantity: group.moQuantity,
            totalDurationHours: totalHours,
            uphValue: uphValue,
            cycleCount: group.cycleCount,
            windowDays: window
          });
        }
      }
    }
    
    // Step 4: Aggregate MO-level UPH to final results
    const aggregationMap = new Map<string, {
      productName: string;
      workCenterCategory: WorkCenterCategory;
      operatorId: number;
      operatorName: string;
      uphValues: number[];
      totalObservations: number;
    }>();
    
    for (const moResult of moUphResults) {
      const aggKey = `${moResult.productName}|${moResult.workCenterCategory}|${moResult.operatorId}`;
      
      if (!aggregationMap.has(aggKey)) {
        aggregationMap.set(aggKey, {
          productName: moResult.productName,
          workCenterCategory: moResult.workCenterCategory,
          operatorId: moResult.operatorId,
          operatorName: moResult.operatorName,
          uphValues: [],
          totalObservations: 0
        });
      }
      
      const agg = aggregationMap.get(aggKey)!;
      agg.uphValues.push(moResult.uphValue);
      agg.totalObservations += moResult.cycleCount;
    }
    
    // Step 5: Calculate final averaged results
    const results: AggregatedUphResult[] = [];
    
    for (const [key, agg] of aggregationMap) {
      if (agg.uphValues.length > 0) {
        const averageUph = agg.uphValues.reduce((sum, uph) => sum + uph, 0) / agg.uphValues.length;
        
        results.push({
          productName: agg.productName,
          workCenterCategory: agg.workCenterCategory,
          operatorId: agg.operatorId,
          operatorName: agg.operatorName,
          averageUph: Math.round(averageUph * 100) / 100,
          moCount: agg.uphValues.length,
          totalObservations: agg.totalObservations,
          windowDays: window,
          dataAvailable: true
        });
      }
    }
    
    // Cache results
    await setInCache(cacheKey, results, 6 * 60 * 60); // 6 hour TTL
    
    return results;
    
  } catch (error) {
    console.error("Error calculating standardized UPH:", error);
    throw error;
  }
}

/**
 * Get UPH for specific operator, product, and work center
 */
export async function getOperatorProductUph(
  operatorId: number,
  productName: string,
  workCenterCategory: WorkCenterCategory,
  windowDays: number = 30
): Promise<number | null> {
  const results = await calculateStandardizedUph({
    operatorId,
    productName,
    workCenterCategory,
    windowDays
  });
  
  if (results.length > 0 && results[0].dataAvailable) {
    return results[0].averageUph;
  }
  
  return null;
}

/**
 * Get all UPH data for the grid and analytics page
 */
export async function getAllUphData(windowDays: number = 30): Promise<AggregatedUphResult[]> {
  return calculateStandardizedUph({ windowDays });
}

// Cache helper functions
function getCacheKey(
  productName?: string,
  workCenterCategory?: WorkCenterCategory,
  operatorId?: number,
  windowDays?: number
): string {
  return `uph:${productName || 'all'}:${workCenterCategory || 'all'}:${operatorId || 'all'}:${windowDays || 30}`;
}

async function getFromCache(key: string): Promise<any | null> {
  // Use memory cache
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  return null;
}

async function setInCache(key: string, data: any, ttlSeconds: number): Promise<void> {
  // Use memory cache
  memoryCache.set(key, {
    data,
    expires: Date.now() + (ttlSeconds * 1000)
  });
  
  // Clean up expired entries
  for (const [k, v] of memoryCache.entries()) {
    if (v.expires < Date.now()) {
      memoryCache.delete(k);
    }
  }
}