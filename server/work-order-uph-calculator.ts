import { db } from './db';
import { workOrders, workCycles, uphData } from '../shared/schema';
import { eq, and, gt, isNotNull, sql } from 'drizzle-orm';
import type { InsertUphData } from '../shared/schema';

export interface WorkOrderUPHResult {
  operator: string;
  workCenter: string;
  productRouting: string;
  operations: string[];
  totalQuantity: number;
  totalDurationHours: number;
  uph: number;
  workOrderCount: number;
}

/**
 * Calculate UPH using work order quantities and cycle durations
 * This fixes the unreliable cycle quantity issue by using work order quantity_done
 */
export async function calculateWorkOrderUPH(): Promise<{
  success: boolean;
  results: WorkOrderUPHResult[];
  totalProcessed: number;
}> {
  console.log('Starting Work Order UPH calculation...');
  
  try {
    // Use raw SQL to replicate the successful query logic
    const rawResults = await db.execute(sql`
      SELECT 
        wc.work_id,
        wc.work_cycles_operator_rec_name as operator,
        wc.work_cycles_work_center_rec_name as work_center,
        wc.work_production_routing_rec_name as routing,
        wc.work_operation_rec_name as operation,
        wc.work_production_number as mo_number,
        wo.quantity_done,
        wc.work_cycles_duration
      FROM work_orders wo
      INNER JOIN work_cycles wc ON wc.work_id = wo.fulfil_id
      WHERE wo.quantity_done IS NOT NULL 
        AND wc.work_cycles_duration > 0
        AND wo.quantity_done > 0
    `);

    console.log(`Found ${rawResults.rows.length} valid work order + cycle combinations`);

    // First aggregate by work order to get correct quantities and total time per work order
    const workOrderAggregates = new Map<string, {
      operator: string;
      workCenter: string;
      productRouting: string;
      operation: string;
      quantity: number;
      totalDuration: number;
      moNumber: string;
    }>();

    for (const row of rawResults.rows) {
      const operator = row.operator as string;
      const workCenter = row.work_center as string;
      const routing = row.routing as string;
      const operation = row.operation as string;
      const quantity = Number(row.quantity_done);
      const duration = Number(row.work_cycles_duration);
      const moNumber = row.mo_number as string;

      // Key by work_id to aggregate cycles per work order
      const workOrderKey = `${row.work_id}|${operator}|${workCenter}|${routing}|${operation}|${moNumber}`;
      
      if (!workOrderAggregates.has(workOrderKey)) {
        workOrderAggregates.set(workOrderKey, {
          operator,
          workCenter,
          productRouting: routing,
          operation,
          quantity, // Work order quantity (same for all cycles of this work order)
          totalDuration: 0,
          moNumber
        });
      }
      
      const aggregate = workOrderAggregates.get(workOrderKey)!;
      aggregate.totalDuration += duration; // Sum cycle durations for this work order
    }

    console.log(`Aggregated ${workOrderAggregates.size} individual work orders`);

    // Now group by operator + work center + routing for final UPH calculation
    const groupedResults = new Map<string, {
      operator: string;
      workCenter: string;
      productRouting: string;
      operations: Set<string>;
      totalQuantity: number;
      totalDuration: number;
      workOrderCount: number;
    }>();

    for (const [workOrderKey, aggregate] of workOrderAggregates) {
      const groupKey = `${aggregate.operator}|${aggregate.workCenter}|${aggregate.productRouting}`;
      
      console.log(`Work order: ${aggregate.moNumber} - ${aggregate.quantity} units in ${(aggregate.totalDuration/3600).toFixed(2)} hours = ${(aggregate.quantity / (aggregate.totalDuration/3600)).toFixed(2)} UPH`);
      
      if (!groupedResults.has(groupKey)) {
        groupedResults.set(groupKey, {
          operator: aggregate.operator,
          workCenter: aggregate.workCenter,
          productRouting: aggregate.productRouting,
          operations: new Set(),
          totalQuantity: 0,
          totalDuration: 0,
          workOrderCount: 0
        });
      }
      
      const group = groupedResults.get(groupKey)!;
      group.operations.add(aggregate.operation);
      group.totalQuantity += aggregate.quantity;
      group.totalDuration += aggregate.totalDuration;
      group.workOrderCount++;
    }

    console.log(`Grouped into ${groupedResults.size} UPH combinations`);

    // Calculate UPH for each group
    const results: WorkOrderUPHResult[] = [];

    for (const [key, group] of groupedResults) {
      if (group.workOrderCount === 0 || group.totalDuration === 0) continue;

      const totalDurationHours = group.totalDuration / 3600;
      const uph = group.totalQuantity / totalDurationHours;

      console.log(`${group.operator} - ${group.workCenter} - ${group.productRouting}: ${group.totalQuantity} units / ${totalDurationHours.toFixed(2)} hours = ${uph.toFixed(2)} UPH`);

      results.push({
        operator: group.operator,
        workCenter: group.workCenter,
        productRouting: group.productRouting,
        operations: Array.from(group.operations).sort(),
        totalQuantity: group.totalQuantity,
        totalDurationHours,
        uph,
        workOrderCount: group.workOrderCount
      });
    }

    // Sort by UPH descending
    results.sort((a, b) => b.uph - a.uph);

    console.log(`Calculated UPH for ${results.length} combinations`);

    // Clear existing UPH data and insert new calculations
    await db.delete(uphData);
    
    // Filter valid results (should all be valid now due to SQL filtering)
    const validResults = results.filter(result => 
      result.operator && result.operator.trim() !== '' &&
      result.workCenter && result.workCenter.trim() !== '' &&
      result.productRouting && result.productRouting.trim() !== '' &&
      result.operations && result.operations.length > 0 &&
      result.uph > 0 && result.uph < 1000 // Reasonable UPH bounds
    );

    console.log(`Filtered ${results.length} results to ${validResults.length} valid results`);

    const uphInserts: InsertUphData[] = validResults.map(result => ({
      operatorName: result.operator,
      workCenter: result.workCenter,
      productRouting: result.productRouting,
      operation: result.operations.join(', '),
      uph: result.uph,
      observationCount: result.workOrderCount,
      totalDurationHours: result.totalDurationHours,
      totalQuantity: result.totalQuantity,
      dataSource: 'work_order_quantities'
    }));

    if (uphInserts.length > 0) {
      console.log(`Sample insert data:`, uphInserts[0]);
      await db.insert(uphData).values(uphInserts);
      console.log(`Inserted ${uphInserts.length} UPH calculations using work order quantities`);
    }

    return {
      success: true,
      results,
      totalProcessed: rawResults.rows.length
    };

  } catch (error) {
    console.error('Error calculating work order UPH:', error);
    return {
      success: false,
      results: [],
      totalProcessed: 0
    };
  }
}