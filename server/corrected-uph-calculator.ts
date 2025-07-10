import { db } from './db';
import { workCycles, uphData, type InsertUphData } from '../shared/schema';
import { eq, and, gte, gt } from 'drizzle-orm';
import { fetchDoneWorkCycles, fetchDoneMOQuantities } from './fulfil-paginated-client';

export interface UPHCalculationResult {
  operator: string;
  workCenter: string;
  productRouting: string;
  operations: string[]; // All operations aggregated within this work center
  cycleCount: number;
  totalDurationSeconds: number;
  totalDurationHours: number;
  totalQuantity: number;
  uph: number;
  validCycles: number;
  filteredCycles: number;
}

/**
 * Calculate UPH using all available data without filtering
 */
export async function calculateCorrectedUPH(): Promise<{
  success: boolean;
  results: UPHCalculationResult[];
  totalProcessed: number;
  totalFiltered: number;
}> {
  console.log('Starting UPH calculation without filtering...');
  
  try {
    // Get all work cycles data with valid duration (include both production and setup cycles)
    const rawCycles = await db
      .select()
      .from(workCycles)
      .where(
        and(
          gt(workCycles.work_cycles_duration, 0), // Must have duration > 0
          // Note: NOT filtering by quantity here - we need all cycles for proper MO aggregation
        )
      );

    console.log(`Found ${rawCycles.length} work cycles with valid duration and quantity`);

    // Step 1: Aggregate cycles by MO + Operation first to handle one-to-many relationship
    const moOperationAggregates = new Map<string, {
      operator: string;
      workCenter: string;
      productRouting: string;
      moNumber: string;
      operation: string;
      totalQuantity: number;
      totalDuration: number;
      cycleCount: number;
    }>();

    for (const cycle of rawCycles) {
      // Skip cycles with missing critical data
      if (!cycle.work_cycles_operator_rec_name || 
          !cycle.work_production_routing_rec_name || 
          !cycle.work_operation_rec_name ||
          !cycle.work_production_number) {
        continue;
      }

      // Clean up work center names
      let workCenter = cycle.work_cycles_work_center_rec_name || 'Unknown';
      if (workCenter.includes('Assembly')) workCenter = 'Assembly';
      else if (workCenter.includes('Cutting')) workCenter = 'Cutting';
      else if (workCenter.includes('Packaging')) workCenter = 'Packaging';
      else if (workCenter.includes('Sewing')) workCenter = 'Assembly';

      const key = `${cycle.work_cycles_operator_rec_name}|${workCenter}|${cycle.work_production_routing_rec_name}|${cycle.work_production_number}|${cycle.work_operation_rec_name}`;
      
      if (!moOperationAggregates.has(key)) {
        moOperationAggregates.set(key, {
          operator: cycle.work_cycles_operator_rec_name,
          workCenter,
          productRouting: cycle.work_production_routing_rec_name,
          moNumber: cycle.work_production_number,
          operation: cycle.work_operation_rec_name,
          totalQuantity: 0,
          totalDuration: 0,
          cycleCount: 0
        });
      }
      
      const aggregate = moOperationAggregates.get(key)!;
      aggregate.totalQuantity += cycle.work_cycles_quantity_done;
      aggregate.totalDuration += cycle.work_cycles_duration;
      aggregate.cycleCount++;
    }

    console.log(`Aggregated ${moOperationAggregates.size} MO+Operation combinations`);

    // Step 2: Group by operator + work center + routing, but only include operations with actual production
    const groupedResults = new Map<string, {
      operator: string;
      workCenter: string;
      productRouting: string;
      operations: Set<string>;
      totalQuantity: number;
      totalDuration: number;
      cycleCount: number;
    }>();

    // Step 3: Now aggregate by MO to get the actual produced quantity vs total time per MO
    const moResults = new Map<string, {
      operator: string;
      workCenter: string;
      productRouting: string;
      moNumber: string;
      operations: Set<string>;
      totalQuantity: number;
      totalDuration: number;
      cycleCount: number;
    }>();

    for (const [key, aggregate] of moOperationAggregates) {
      const moKey = `${aggregate.operator}|${aggregate.workCenter}|${aggregate.productRouting}|${aggregate.moNumber}`;
      
      if (!moResults.has(moKey)) {
        moResults.set(moKey, {
          operator: aggregate.operator,
          workCenter: aggregate.workCenter,
          productRouting: aggregate.productRouting,
          moNumber: aggregate.moNumber,
          operations: new Set(),
          totalQuantity: 0,
          totalDuration: 0,
          cycleCount: 0
        });
      }
      
      const moResult = moResults.get(moKey)!;
      moResult.operations.add(aggregate.operation);
      moResult.totalQuantity += aggregate.totalQuantity; // Sum all quantities for this MO
      moResult.totalDuration += aggregate.totalDuration; // Sum ALL time (including setup)
      moResult.cycleCount += aggregate.cycleCount;
    }

    console.log(`Aggregated ${moResults.size} MO-level results`);

    // Step 4: Group by operator + work center + routing across all MOs
    for (const [key, moResult] of moResults) {
      // Only include MOs that actually produced units
      if (moResult.totalQuantity === 0) continue;

      const groupKey = `${moResult.operator}|${moResult.workCenter}|${moResult.productRouting}`;
      
      if (!groupedResults.has(groupKey)) {
        groupedResults.set(groupKey, {
          operator: moResult.operator,
          workCenter: moResult.workCenter,
          productRouting: moResult.productRouting,
          operations: new Set(),
          totalQuantity: 0,
          totalDuration: 0,
          cycleCount: 0
        });
      }
      
      const group = groupedResults.get(groupKey)!;
      moResult.operations.forEach(op => group.operations.add(op));
      group.totalQuantity += moResult.totalQuantity;
      group.totalDuration += moResult.totalDuration;
      group.cycleCount += moResult.cycleCount;
    }

    console.log(`Grouped into ${groupedResults.size} operator/work center/routing combinations`);

    // Calculate UPH for each group using properly aggregated MO data
    const results: UPHCalculationResult[] = [];
    let totalFiltered = 0; // No filtering, so this will be 0

    for (const [key, group] of groupedResults) {
      if (group.cycleCount === 0) continue;

      const totalDurationHours = group.totalDuration / 3600;
      const uph = group.totalQuantity / totalDurationHours;

      results.push({
        operator: group.operator,
        workCenter: group.workCenter,
        productRouting: group.productRouting,
        operations: Array.from(group.operations).sort(), // All operations aggregated
        cycleCount: group.cycleCount,
        totalDurationSeconds: group.totalDuration,
        totalDurationHours,
        totalQuantity: group.totalQuantity,
        uph,
        validCycles: group.cycleCount,
        filteredCycles: 0 // No filtering applied
      });
    }

    // Sort by UPH descending
    results.sort((a, b) => b.uph - a.uph);

    console.log(`Calculated UPH for ${results.length} combinations`);
    console.log(`Total cycles filtered out: ${totalFiltered}`);

    // Clear existing UPH data and insert new calculations
    await db.delete(uphData);
    
    // Filter out any results with null or empty critical fields before inserting
    const validResults = results.filter(result => 
      result.operator && result.operator.trim() !== '' &&
      result.workCenter && result.workCenter.trim() !== '' &&
      result.productRouting && result.productRouting.trim() !== '' &&
      result.operations && result.operations.length > 0
    );

    console.log(`Filtered ${results.length} results to ${validResults.length} valid results`);

    const uphInserts: InsertUphData[] = validResults.map(result => ({
      operatorName: result.operator,
      workCenter: result.workCenter,
      productRouting: result.productRouting,
      operation: result.operations.join(', '), // Store all operations as comma-separated
      uph: result.uph,
      observationCount: result.validCycles,
      totalDurationHours: result.totalDurationHours,
      totalQuantity: result.totalQuantity,
      dataSource: 'work_cycles_aggregated'
    }));

    if (uphInserts.length > 0) {
      console.log(`Sample insert data:`, uphInserts[0]);
      await db.insert(uphData).values(uphInserts);
      console.log(`Inserted ${uphInserts.length} UPH calculations`);
    }

    return {
      success: true,
      results,
      totalProcessed: rawCycles.length,
      totalFiltered
    };

  } catch (error) {
    console.error('Error calculating corrected UPH:', error);
    return {
      success: false,
      results: [],
      totalProcessed: 0,
      totalFiltered: 0
    };
  }
}

/**
 * Update UPH data with real MO quantities from Fulfil API
 */
export async function updateDoneQuantitiesInUPH() {
  try {
    console.log('Fetching done MO quantities from Fulfil...');
    const doneMOs = await fetchDoneMOQuantities();
    
    console.log(`Found ${doneMOs.length} done MOs`);

    let updatedCount = 0;
    for (const mo of doneMOs) {
      const result = await db.update(uphData)
        .set({ total_quantity: mo.quantity })
        .where(eq(uphData.production_id, mo.id));
      
      if (result.rowCount && result.rowCount > 0) {
        updatedCount++;
      }
    }

    console.log(`Updated quantities for ${updatedCount} UPH records`);
    return { success: true, updated: updatedCount, total: doneMOs.length };

  } catch (error) {
    console.error('Error updating done quantities:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get UPH statistics for reporting
 */
export async function getUPHStatistics() {
  try {
    const stats = await db
      .select()
      .from(uphData)
      .orderBy(uphData.uph);

    const totalRecords = stats.length;
    const avgUPH = stats.reduce((sum, record) => sum + record.uph, 0) / totalRecords;
    const minUPH = Math.min(...stats.map(s => s.uph));
    const maxUPH = Math.max(...stats.map(s => s.uph));

    // Group by work center
    const workCenterStats = stats.reduce((acc, record) => {
      const wc = record.work_center;
      if (!acc[wc]) {
        acc[wc] = { count: 0, totalUPH: 0, records: [] };
      }
      acc[wc].count++;
      acc[wc].totalUPH += record.uph;
      acc[wc].records.push(record);
      return acc;
    }, {} as Record<string, { count: number; totalUPH: number; records: any[] }>);

    // Calculate averages for each work center
    const workCenterAverages = Object.entries(workCenterStats).map(([workCenter, data]) => ({
      workCenter,
      avgUPH: data.totalUPH / data.count,
      recordCount: data.count,
      minUPH: Math.min(...data.records.map(r => r.uph)),
      maxUPH: Math.max(...data.records.map(r => r.uph))
    }));

    return {
      totalRecords,
      avgUPH,
      minUPH,
      maxUPH,
      workCenterAverages
    };

  } catch (error) {
    console.error('Error getting UPH statistics:', error);
    throw error;
  }
}