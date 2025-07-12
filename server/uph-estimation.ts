import { db } from "./db.js";
import { historicalUph, operators, workOrders, productionOrders } from "../shared/schema.js";
import { eq, and } from "drizzle-orm";

export interface WorkOrderEstimate {
  workOrderId: number;
  estimatedHours: number;
  operatorName: string;
  workCenter: string;
  routing: string;
  quantity: number;
  uph: number | null;
  dataSource: 'historical_uph' | 'no_data';
}

export interface ProductionOrderEstimate {
  productionOrderId: number;
  moNumber: string;
  workCenterEstimates: {
    [workCenter: string]: {
      estimatedHours: number;
      operatorName: string | null;
      workOrderIds: number[];
      hasActualData: boolean;
    };
  };
  totalEstimatedHours: number;
}

/**
 * Calculate estimated completion time for work orders based on:
 * - Operator assignment (must be assigned to calculate)
 * - Historical UPH data for that operator + work center + routing combination
 * - Work order quantity
 * 
 * CRITICAL: Only uses actual historical data, never estimates
 */
export class UphEstimationService {
  
  /**
   * Get estimated hours for a specific work order with assigned operator
   */
  async getWorkOrderEstimate(
    workOrderId: number,
    assignedOperatorId: number,
    quantity: number,
    workCenter: string,
    routing: string
  ): Promise<WorkOrderEstimate | null> {
    
    // Get operator details
    const operator = await db
      .select()
      .from(operators)
      .where(eq(operators.id, assignedOperatorId))
      .limit(1);
    
    if (!operator.length) {
      return null;
    }
    
    const operatorName = operator[0].name;
    
    // Look for historical UPH data for this exact combination
    const uphRecords = await db
      .select()
      .from(historicalUph)
      .where(
        and(
          eq(historicalUph.operator, operatorName),
          eq(historicalUph.workCenter, workCenter),
          eq(historicalUph.routing, routing)
        )
      );
    
    if (!uphRecords.length) {
      // No historical data available - return null to indicate no estimate possible
      console.log(`No UPH data found for ${operatorName} + ${workCenter} + ${routing}`);
      return {
        workOrderId,
        estimatedHours: 0,
        operatorName,
        workCenter,
        routing,
        quantity,
        uph: null,
        dataSource: 'no_data'
      };
    }
    
    // Use the most recent UPH calculation (highest unitsPerHour with most observations)
    const bestUphRecord = uphRecords.reduce((best, current) => {
      if (current.observations > best.observations) {
        return current;
      }
      if (current.observations === best.observations && current.unitsPerHour > best.unitsPerHour) {
        return current;
      }
      return best;
    });
    
    const estimatedHours = quantity / bestUphRecord.unitsPerHour;
    
    console.log(`UPH Estimate: ${operatorName} ${workCenter} ${routing} - ${quantity} units ÷ ${bestUphRecord.unitsPerHour} UPH = ${estimatedHours.toFixed(2)}h`);
    
    return {
      workOrderId,
      estimatedHours,
      operatorName,
      workCenter,
      routing,
      quantity,
      uph: bestUphRecord.unitsPerHour,
      dataSource: 'historical_uph'
    };
  }
  
  /**
   * Calculate estimates for all work orders in a production order
   */
  async getProductionOrderEstimates(productionOrderId: number): Promise<ProductionOrderEstimate | null> {
    
    // Get production order details
    const productionOrder = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, productionOrderId))
      .limit(1);
    
    if (!productionOrder.length) {
      return null;
    }
    
    const moNumber = productionOrder[0].moNumber;
    const routing = productionOrder[0].routing || 'Unknown';
    
    // Get all work orders for this production order
    const workOrdersList = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.productionOrderId, productionOrderId));
    
    const workCenterEstimates: { [workCenter: string]: any } = {};
    let totalEstimatedHours = 0;
    
    // Group work orders by work center
    const workOrdersByCenter = workOrdersList.reduce((acc, wo) => {
      if (!acc[wo.workCenter]) {
        acc[wo.workCenter] = [];
      }
      acc[wo.workCenter].push(wo);
      return acc;
    }, {} as { [workCenter: string]: typeof workOrdersList });
    
    // Calculate estimates for each work center
    for (const [workCenter, workOrdersInCenter] of Object.entries(workOrdersByCenter)) {
      let centerEstimatedHours = 0;
      let operatorName: string | null = null;
      let hasActualData = false;
      const workOrderIds = workOrdersInCenter.map(wo => wo.id);
      
      for (const workOrder of workOrdersInCenter) {
        if (workOrder.assignedOperatorId) {
          const estimate = await this.getWorkOrderEstimate(
            workOrder.id,
            workOrder.assignedOperatorId,
            productionOrder[0].quantity, // Use production order quantity
            workCenter,
            routing
          );
          
          if (estimate) {
            centerEstimatedHours += estimate.estimatedHours;
            operatorName = estimate.operatorName;
            if (estimate.dataSource === 'historical_uph') {
              hasActualData = true;
            }
          }
        }
      }
      
      workCenterEstimates[workCenter] = {
        estimatedHours: centerEstimatedHours,
        operatorName,
        workOrderIds,
        hasActualData
      };
      
      totalEstimatedHours += centerEstimatedHours;
    }
    
    return {
      productionOrderId,
      moNumber,
      workCenterEstimates,
      totalEstimatedHours
    };
  }
  
  /**
   * Batch calculate estimates for multiple production orders
   */
  async getBatchEstimates(productionOrderIds: number[]): Promise<ProductionOrderEstimate[]> {
    const estimates: ProductionOrderEstimate[] = [];
    
    for (const id of productionOrderIds) {
      const estimate = await this.getProductionOrderEstimates(id);
      if (estimate) {
        estimates.push(estimate);
      }
    }
    
    return estimates;
  }
}

export const uphEstimationService = new UphEstimationService();