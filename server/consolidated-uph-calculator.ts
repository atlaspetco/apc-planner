import { db } from './db.js';
import { workOrderDurations } from '../shared/schema.js';
import { sql } from 'drizzle-orm';

/**
 * Consolidated UPH Calculator
 * Merges work order durations by operator and work center
 * Maps all operations to 3 main work centers: Cutting, Assembly, Packaging
 */

/**
 * Work center mapping function
 * Maps various work center names to the 3 main categories
 */
function mapToMainWorkCenter(workCenter: string): string {
  const center = workCenter.toLowerCase();
  
  // Cutting operations
  if (center.includes('cutting') || center.includes('laser') || center.includes('webbing cutter')) {
    return 'Cutting';
  }
  
  // Packaging operations
  if (center.includes('packaging') || center.includes('pack')) {
    return 'Packaging';
  }
  
  // Assembly operations (default for everything else)
  // Includes: Sewing, Rope, Zipper Pull, Embroidery, Assembly, etc.
  return 'Assembly';
}

/**
 * Extract operation and work center from work_cycles_rec_name field
 * Example: "Sewing | Courtney Banh | Assembly" -> { operation: "Sewing", operator: "Courtney Banh", workCenter: "Assembly" }
 */
function parseWorkCycleRecName(recName: string): { operation: string; operator: string; workCenter: string } {
  const parts = recName.split(' | ').map(p => p.trim());
  
  if (parts.length >= 3) {
    return {
      operation: parts[0],
      operator: parts[1],
      workCenter: mapToMainWorkCenter(parts[2])
    };
  }
  
  // Fallback for incomplete data
  return {
    operation: parts[0] || 'Unknown',
    operator: parts[1] || 'Unknown',
    workCenter: 'Assembly' // Default to Assembly
  };
}

/**
 * Calculate consolidated UPH by merging work orders from same operator in same work center
 */
export async function calculateConsolidatedUPH() {
  console.log('Starting consolidated UPH calculation...');
  
  try {
    // Get all work order durations
    const workOrders = await db.select().from(workOrderDurations);
    console.log(`Processing ${workOrders.length} work orders for consolidation`);
    
    // Group by operator + main work center
    const consolidatedData = new Map<string, {
      operator_name: string;
      main_work_center: string;
      total_duration_seconds: number;
      total_quantity_done: number;
      work_order_count: number;
      operations: Set<string>;
    }>();
    
    for (const workOrder of workOrders) {
      // Parse the work order ID to get operation info
      const workOrderParts = workOrder.work_order_id.split(' | ');
      const operation = workOrderParts[0]?.replace(/^WO\d+\s*\|\s*/, '') || 'Unknown';
      
      // Use operator name and work center from the work order
      const operatorName = workOrder.operator_name || 'Unknown';
      const mainWorkCenter = mapToMainWorkCenter(workOrder.work_center || 'Assembly');
      
      const key = `${operatorName}|${mainWorkCenter}`;
      
      if (!consolidatedData.has(key)) {
        consolidatedData.set(key, {
          operator_name: operatorName,
          main_work_center: mainWorkCenter,
          total_duration_seconds: 0,
          total_quantity_done: 0,
          work_order_count: 0,
          operations: new Set()
        });
      }
      
      const consolidated = consolidatedData.get(key)!;
      consolidated.total_duration_seconds += workOrder.total_duration_seconds;
      consolidated.total_quantity_done += workOrder.total_quantity_done || 0;
      consolidated.work_order_count += 1;
      consolidated.operations.add(operation);
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
        units_per_hour: Math.round(uph * 100) / 100
      };
    });
    
    // Sort by operator and work center
    consolidatedUPH.sort((a, b) => {
      if (a.operator_name !== b.operator_name) {
        return a.operator_name.localeCompare(b.operator_name);
      }
      return a.main_work_center.localeCompare(b.main_work_center);
    });
    
    console.log(`Generated ${consolidatedUPH.length} consolidated UPH records`);
    console.log('Sample consolidated records:');
    consolidatedUPH.slice(0, 5).forEach(record => {
      console.log(`${record.operator_name} | ${record.main_work_center}: ${record.units_per_hour} UPH (${record.work_order_count} work orders)`);
    });
    
    return consolidatedUPH;
    
  } catch (error) {
    console.error('Error calculating consolidated UPH:', error);
    throw error;
  }
}

/**
 * Get work center summary statistics
 */
export async function getWorkCenterSummary() {
  const consolidatedUPH = await calculateConsolidatedUPH();
  
  const summary = {
    cutting: { operators: 0, avg_uph: 0, total_work_orders: 0 },
    assembly: { operators: 0, avg_uph: 0, total_work_orders: 0 },
    packaging: { operators: 0, avg_uph: 0, total_work_orders: 0 }
  };
  
  // Group by work center
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
  
  return summary;
}