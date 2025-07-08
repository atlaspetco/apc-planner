import { db } from "./db.js";
import { workCycles, productionOrders, operators, uphData } from "../shared/schema.js";
import { eq, and, gte, sql, isNotNull } from "drizzle-orm";

/**
 * Calculate UPH from work cycles data
 * Groups by Operator, Routing, Work Center, and Operation
 * Averages over the last 30 days (configurable per operator)
 */

interface UphCalculation {
  operator: string;
  routing: string;
  workCenter: string;
  operation: string;
  totalQuantity: number;
  totalHours: number;
  unitsPerHour: number;
  observations: number;
  averageDays: number;
}

export async function calculateUphFromWorkOrders(): Promise<{
  success: boolean;
  message: string;
  calculations: UphCalculation[];
  totalCalculations: number;
}> {
  console.log('Starting UPH calculation from work cycles...');
  
  try {
    // Get all operators with their UPH calculation windows (default 30 days)
    const operatorsList = await db.select({
      id: operators.id,
      name: operators.name,
      calculationWindow: operators.uphCalculationWindow
    }).from(operators);
    
    console.log(`Found ${operatorsList.length} operators for UPH calculation`);
    
    const calculations: UphCalculation[] = [];
    
    for (const operator of operatorsList) {
      const calculationDays = operator.calculationWindow || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - calculationDays);
      
      // Get work cycles for this operator within the time window
      const operatorWorkCycles = await db.select({
        workCenter: workCycles.work_cycles_work_center_rec_name,
        operator: workCycles.work_cycles_operator_rec_name,
        routing: workCycles.work_production_routing_rec_name,
        quantity: workCycles.work_cycles_quantity_done,
        duration: workCycles.work_cycles_duration,
        productionNumber: workCycles.work_production_number,
        createdAt: workCycles.createdAt
      }).from(workCycles)
      .where(
        and(
          eq(workCycles.work_cycles_operator_rec_name, operator.name),
          gte(workCycles.createdAt, cutoffDate),
          sql`${workCycles.work_cycles_duration} > 0`,
          sql`${workCycles.work_cycles_quantity_done} > 0`,
          isNotNull(workCycles.work_cycles_operator_rec_name),
          isNotNull(workCycles.work_cycles_work_center_rec_name)
        )
      );
      
      console.log(`Found ${operatorWorkCycles.length} work cycles for ${operator.name} in last ${calculationDays} days`);
      
      // Get routing data from production orders
      const uniqueProductionNumbers = [...new Set(operatorWorkCycles.map(wc => wc.productionNumber).filter(Boolean))];
      const routingLookup = new Map<string, string>();
      
      if (uniqueProductionNumbers.length > 0) {
        const productionOrderData = await db.select({
          moNumber: productionOrders.moNumber,
          routing: productionOrders.routing
        }).from(productionOrders);
        
        for (const po of productionOrderData) {
          if (po.routing) {
            routingLookup.set(po.moNumber, po.routing);
          }
        }
      }
      
      // Group by routing, work center, and operation
      const groupedData = new Map<string, {
        routing: string;
        workCenter: string;
        operation: string;
        totalQuantity: number;
        totalDuration: number;
        observations: number;
      }>();
      
      for (const wc of operatorWorkCycles) {
        if (!wc.workCenter || !wc.quantity || !wc.duration) continue;
        
        // Get routing from production order lookup, fallback to cycle routing, then 'Unknown'
        const routing = routingLookup.get(wc.productionNumber || '') || wc.routing || 'Unknown';
        
        // Extract operation from work center name (e.g., "Sewing - LH" -> "Sewing")
        const operation = wc.workCenter.includes(' - ') ? 
          wc.workCenter.split(' - ')[0] : wc.workCenter;
        
        const key = `${routing}|${wc.workCenter}|${operation}`;
        
        if (!groupedData.has(key)) {
          groupedData.set(key, {
            routing,
            workCenter: wc.workCenter,
            operation,
            totalQuantity: 0,
            totalDuration: 0,
            observations: 0
          });
        }
        
        const group = groupedData.get(key)!;
        group.totalQuantity += wc.quantity;
        group.totalDuration += wc.duration;
        group.observations += 1;
      }
      
      // Calculate UPH for each group
      for (const [key, data] of groupedData) {
        if (data.totalDuration > 0 && data.observations >= 2) { // Minimum 2 observations
          const totalHours = data.totalDuration / 3600; // Convert seconds to hours
          const unitsPerHour = data.totalQuantity / totalHours;
          
          // Only include realistic UPH values
          if (unitsPerHour > 0 && unitsPerHour < 200 && totalHours >= 0.033) { // At least 2 minutes
            calculations.push({
              operator: operator.name,
              routing: data.routing,
              workCenter: data.workCenter,
              operation: data.operation,
              totalQuantity: data.totalQuantity,
              totalHours: totalHours,
              unitsPerHour: Math.round(unitsPerHour * 100) / 100,
              observations: data.observations,
              averageDays: calculationDays
            });
          }
        }
      }
    }
    
    console.log(`Calculated ${calculations.length} UPH metrics from work cycles`);
    
    // Store UPH calculations in database
    if (calculations.length > 0) {
      // Clear existing UPH data
      await db.delete(uphData);
      
      // Insert new calculations
      for (const calc of calculations) {
        await db.insert(uphData).values({
          routing: calc.routing,
          workCenter: calc.workCenter,
          operation: calc.operation,
          operatorId: operatorsList.find(op => op.name === calc.operator)?.id || null,
          unitsPerHour: calc.unitsPerHour,
          calculationPeriod: calc.averageDays
        });
      }
      
      console.log(`Stored ${calculations.length} UPH calculations in database`);
    }
    
    return {
      success: true,
      message: `Calculated UPH for ${calculations.length} operator/routing/work center/operation combinations from work cycles`,
      calculations,
      totalCalculations: calculations.length
    };
    
  } catch (error) {
    console.error('Error calculating UPH from work cycles:', error);
    return {
      success: false,
      message: `Failed to calculate UPH: ${error instanceof Error ? error.message : 'Unknown error'}`,
      calculations: [],
      totalCalculations: 0
    };
  }
}

/**
 * Get UPH data formatted for the operators table display
 * Returns Product Templates (rows) × Work Centers (columns) format
 */
export async function getOperatorUphTable(): Promise<{
  success: boolean;
  tableData: Array<{
    operator: string;
    productTemplate: string;
    workCenterData: Record<string, number>; // work center -> average UPH
  }>;
  workCenters: string[];
  productTemplates: string[];
}> {
  try {
    // Get all UPH data with operator information
    const uphResults = await db.select({
      operator: operators.name,
      routing: uphData.routing,
      workCenter: uphData.workCenter,
      operation: uphData.operation,
      unitsPerHour: uphData.unitsPerHour,
      operatorId: uphData.operatorId
    }).from(uphData)
    .leftJoin(operators, eq(uphData.operatorId, operators.id))
    .where(sql`${operators.name} IS NOT NULL`);
    
    // Get unique work centers and product templates
    const workCenters = [...new Set(uphResults.map(r => r.workCenter))].sort();
    const productTemplates = [...new Set(uphResults.map(r => r.routing))].sort();
    
    // Group data by operator and product template
    const operatorTemplateMap = new Map<string, {
      operator: string;
      productTemplate: string;
      workCenterData: Record<string, number[]>; // work center -> array of UPH values
    }>();
    
    for (const result of uphResults) {
      if (!result.operator || !result.routing || !result.workCenter) continue;
      
      const key = `${result.operator}|${result.routing}`;
      
      if (!operatorTemplateMap.has(key)) {
        operatorTemplateMap.set(key, {
          operator: result.operator,
          productTemplate: result.routing,
          workCenterData: {}
        });
      }
      
      const entry = operatorTemplateMap.get(key)!;
      if (!entry.workCenterData[result.workCenter]) {
        entry.workCenterData[result.workCenter] = [];
      }
      
      entry.workCenterData[result.workCenter].push(result.unitsPerHour);
    }
    
    // Calculate averages and format for table display
    const tableData = Array.from(operatorTemplateMap.values()).map(entry => ({
      operator: entry.operator,
      productTemplate: entry.productTemplate,
      workCenterData: Object.fromEntries(
        Object.entries(entry.workCenterData).map(([workCenter, uphValues]) => [
          workCenter,
          Math.round((uphValues.reduce((sum, val) => sum + val, 0) / uphValues.length) * 100) / 100
        ])
      )
    }));
    
    return {
      success: true,
      tableData,
      workCenters,
      productTemplates
    };
    
  } catch (error) {
    console.error('Error getting operator UPH table:', error);
    return {
      success: false,
      tableData: [],
      workCenters: [],
      productTemplates: []
    };
  }
}