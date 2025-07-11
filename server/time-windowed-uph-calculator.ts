import { db } from './db.js';
import { workOrderDurations, workCycles } from '../shared/schema.js';
import { sql, and, gte, lte } from 'drizzle-orm';

/**
 * Time-Windowed UPH Calculator
 * Provides UPH calculations for specific time periods (day, week, month, quarter, year, max)
 */

export type TimeWindow = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'max';

/**
 * Get date range for a specific time window
 */
function getDateRange(window: TimeWindow): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = new Date(); // Current time
  let startDate: Date;

  switch (window) {
    case 'day':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      break;
    case 'quarter':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
      break;
    case 'year':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 365 days ago
      break;
    case 'max':
      startDate = new Date('2020-01-01'); // Far back date to include all data
      break;
    default:
      throw new Error(`Invalid time window: ${window}`);
  }

  return { startDate, endDate };
}

/**
 * Work center mapping function
 */
function mapToMainWorkCenter(workCenter: string): string {
  const center = workCenter.toLowerCase();
  
  if (center.includes('cutting') || center.includes('laser') || center.includes('webbing cutter')) {
    return 'Cutting';
  }
  
  if (center.includes('packaging') || center.includes('pack')) {
    return 'Packaging';
  }
  
  return 'Assembly'; // Default for Sewing, Rope, Zipper Pull, Embroidery, etc.
}

/**
 * Calculate time-windowed UPH for consolidated work centers
 */
export async function calculateTimeWindowedUPH(timeWindow: TimeWindow = 'month') {
  console.log(`Calculating time-windowed UPH for period: ${timeWindow}`);
  
  const { startDate, endDate } = getDateRange(timeWindow);
  console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  try {
    // Get work orders within the time window using latest_cycle_date
    const workOrders = await db
      .select()
      .from(workOrderDurations)
      .where(
        and(
          gte(workOrderDurations.latest_cycle_date, startDate),
          lte(workOrderDurations.latest_cycle_date, endDate)
        )
      );
    
    console.log(`Found ${workOrders.length} work orders in ${timeWindow} period`);
    
    if (workOrders.length === 0) {
      return {
        timeWindow,
        dateRange: { startDate, endDate },
        workOrderCount: 0,
        consolidatedUPH: [],
        summary: {
          cutting: { operators: 0, avg_uph: 0, total_work_orders: 0 },
          assembly: { operators: 0, avg_uph: 0, total_work_orders: 0 },
          packaging: { operators: 0, avg_uph: 0, total_work_orders: 0 }
        }
      };
    }
    
    // Group by operator + main work center
    const consolidatedData = new Map<string, {
      operator_name: string;
      main_work_center: string;
      total_duration_seconds: number;
      total_quantity_done: number;
      work_order_count: number;
      operations: Set<string>;
      earliest_date: Date | null;
      latest_date: Date | null;
    }>();
    
    for (const workOrder of workOrders) {
      const operatorName = workOrder.operator_name || 'Unknown';
      const mainWorkCenter = mapToMainWorkCenter(workOrder.work_center || 'Assembly');
      
      // Extract operation from work order ID
      const workOrderParts = workOrder.work_order_id.split(' | ');
      const operation = workOrderParts[0]?.replace(/^WO\d+\s*\|\s*/, '') || 'Unknown';
      
      const key = `${operatorName}|${mainWorkCenter}`;
      
      if (!consolidatedData.has(key)) {
        consolidatedData.set(key, {
          operator_name: operatorName,
          main_work_center: mainWorkCenter,
          total_duration_seconds: 0,
          total_quantity_done: 0,
          work_order_count: 0,
          operations: new Set(),
          earliest_date: null,
          latest_date: null
        });
      }
      
      const consolidated = consolidatedData.get(key)!;
      consolidated.total_duration_seconds += workOrder.total_duration_seconds;
      consolidated.total_quantity_done += workOrder.total_quantity_done || 0;
      consolidated.work_order_count += 1;
      consolidated.operations.add(operation);
      
      // Track date range for this operator/work center combination
      if (workOrder.earliest_cycle_date) {
        const earliestDate = new Date(workOrder.earliest_cycle_date);
        if (!consolidated.earliest_date || earliestDate < consolidated.earliest_date) {
          consolidated.earliest_date = earliestDate;
        }
      }
      
      if (workOrder.latest_cycle_date) {
        const latestDate = new Date(workOrder.latest_cycle_date);
        if (!consolidated.latest_date || latestDate > consolidated.latest_date) {
          consolidated.latest_date = latestDate;
        }
      }
    }
    
    // Calculate UPH for each consolidated group
    const consolidatedUPH = Array.from(consolidatedData.values()).map(group => {
      const totalHours = group.total_duration_seconds / 3600;
      const uph = totalHours > 0 ? group.total_quantity_done / totalHours : 0;
      
      return {
        operator_name: group.operator_name,
        main_work_center: group.main_work_center,
        total_duration_hours: Math.round(totalHours * 100) / 100,
        total_quantity_done: group.total_quantity_done,
        work_order_count: group.work_order_count,
        operations_list: Array.from(group.operations).join(', '),
        units_per_hour: Math.round(uph * 100) / 100,
        earliest_work_date: group.earliest_date?.toISOString(),
        latest_work_date: group.latest_date?.toISOString(),
        days_span: group.earliest_date && group.latest_date 
          ? Math.ceil((group.latest_date.getTime() - group.earliest_date.getTime()) / (24 * 60 * 60 * 1000))
          : 0
      };
    });
    
    // Sort by operator and work center
    consolidatedUPH.sort((a, b) => {
      if (a.operator_name !== b.operator_name) {
        return a.operator_name.localeCompare(b.operator_name);
      }
      return a.main_work_center.localeCompare(b.main_work_center);
    });
    
    // Generate summary by work center
    const summary = {
      cutting: { operators: 0, avg_uph: 0, total_work_orders: 0 },
      assembly: { operators: 0, avg_uph: 0, total_work_orders: 0 },
      packaging: { operators: 0, avg_uph: 0, total_work_orders: 0 }
    };
    
    const workCenterGroups = {
      Cutting: consolidatedUPH.filter(r => r.main_work_center === 'Cutting'),
      Assembly: consolidatedUPH.filter(r => r.main_work_center === 'Assembly'),
      Packaging: consolidatedUPH.filter(r => r.main_work_center === 'Packaging')
    };
    
    for (const [workCenter, records] of Object.entries(workCenterGroups)) {
      if (records.length > 0) {
        const key = workCenter.toLowerCase() as keyof typeof summary;
        summary[key].operators = records.length;
        summary[key].avg_uph = Math.round((records.reduce((sum, r) => sum + r.units_per_hour, 0) / records.length) * 100) / 100;
        summary[key].total_work_orders = records.reduce((sum, r) => sum + r.work_order_count, 0);
      }
    }
    
    console.log(`Generated ${consolidatedUPH.length} time-windowed UPH records for ${timeWindow}`);
    
    return {
      timeWindow,
      dateRange: { startDate, endDate },
      workOrderCount: workOrders.length,
      consolidatedUPH,
      summary
    };
    
  } catch (error) {
    console.error(`Error calculating time-windowed UPH for ${timeWindow}:`, error);
    throw error;
  }
}

/**
 * Update work order durations with timestamp data from work cycles
 */
export async function updateWorkOrderTimestamps() {
  console.log('Updating work order durations with timestamp data...');
  
  try {
    // Get all work cycles with timestamps
    const cycleTimestamps = await db
      .select({
        work_rec_name: workCycles.work_rec_name,
        operator_write_date: workCycles.work_cycles_operator_write_date,
      })
      .from(workCycles)
      .where(sql`${workCycles.work_cycles_operator_write_date} IS NOT NULL`);
    
    console.log(`Found ${cycleTimestamps.length} work cycles with timestamps`);
    
    // Group by work order ID and find min/max dates
    const workOrderTimestamps = new Map<string, {
      earliest: Date;
      latest: Date;
      count: number;
    }>();
    
    for (const cycle of cycleTimestamps) {
      if (!cycle.work_rec_name || !cycle.operator_write_date) continue;
      
      // Extract work order ID (e.g., "WO13942 | Sewing" -> "WO13942")
      const workOrderId = cycle.work_rec_name.split(' |')[0]?.trim();
      if (!workOrderId) continue;
      
      const timestamp = new Date(cycle.operator_write_date);
      
      if (!workOrderTimestamps.has(workOrderId)) {
        workOrderTimestamps.set(workOrderId, {
          earliest: timestamp,
          latest: timestamp,
          count: 1
        });
      } else {
        const existing = workOrderTimestamps.get(workOrderId)!;
        if (timestamp < existing.earliest) existing.earliest = timestamp;
        if (timestamp > existing.latest) existing.latest = timestamp;
        existing.count += 1;
      }
    }
    
    console.log(`Grouped timestamps for ${workOrderTimestamps.size} work orders`);
    
    // Update each work order with timestamp data
    let updatedCount = 0;
    for (const [workOrderId, timestamps] of workOrderTimestamps) {
      try {
        await db
          .update(workOrderDurations)
          .set({
            earliest_cycle_date: timestamps.earliest,
            latest_cycle_date: timestamps.latest,
            work_completed_date: timestamps.latest, // Use latest as completion date
          })
          .where(sql`${workOrderDurations.work_order_id} = ${workOrderId}`);
        
        updatedCount++;
      } catch (error) {
        console.error(`Error updating timestamps for ${workOrderId}:`, error);
      }
    }
    
    console.log(`Successfully updated ${updatedCount} work orders with timestamp data`);
    
    return {
      success: true,
      totalCycles: cycleTimestamps.length,
      workOrdersProcessed: workOrderTimestamps.size,
      workOrdersUpdated: updatedCount
    };
    
  } catch (error) {
    console.error('Error updating work order timestamps:', error);
    throw error;
  }
}