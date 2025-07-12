import { db } from "./db.js";
import { workCycles, uphData } from "../shared/schema.js";
import { parseRecName } from "./rec-name-parser.js";

/**
 * Enhanced UPH calculation using rec_name field for proper work center aggregation
 * This implementation uses the rec_name field to automatically separate operations:
 * - All "Cutting" operations → Cutting work center
 * - All "Packaging" operations → Packaging work center  
 * - Everything else (Sewing, Assembly, Grommet, Zipper Pull) → Assembly work center
 */
export async function calculateEnhancedUPH() {
  console.log("🚀 Starting enhanced UPH calculation using rec_name field aggregation...");
  
  try {
    // Get all work cycles with rec_name data
    const allCycles = await db.select().from(workCycles);
    console.log(`📊 Processing ${allCycles.length} work cycles with rec_name parsing`);
    
    // Group and aggregate by operator + work center + MO using rec_name parsing
    const aggregatedData = new Map<string, {
      operatorName: string;
      workCenter: string;
      manufacturingOrder: string;
      totalDuration: number;
      totalQuantity: number;
      cycleCount: number;
      operations: Set<string>;
    }>();
    
    for (const cycle of allCycles) {
      if (!cycle.work_cycles_rec_name || !cycle.work_cycles_duration || !cycle.work_cycles_operator_rec_name) {
        continue;
      }
      
      // Parse rec_name to extract operation and MO information
      const parsed = parseRecName(cycle.work_cycles_rec_name);
      
      if (!parsed.manufacturingOrderNumber || !parsed.operation) {
        console.log(`⚠️ Skipping cycle - incomplete rec_name parsing:`, parsed);
        continue;
      }
      
      // Consolidate work centers based on operation type
      let workCenter = 'Assembly'; // Default fallback
      if (parsed.operation.toLowerCase().includes('cutting')) {
        workCenter = 'Cutting';
      } else if (parsed.operation.toLowerCase().includes('packaging')) {
        workCenter = 'Packaging';
      } else {
        // Sewing, Assembly, Grommet, Zipper Pull all go to Assembly
        workCenter = 'Assembly';
      }
      
      const operatorName = cycle.work_cycles_operator_rec_name;
      const key = `${operatorName}|${workCenter}|${parsed.manufacturingOrderNumber}`;
      
      if (!aggregatedData.has(key)) {
        aggregatedData.set(key, {
          operatorName,
          workCenter,
          manufacturingOrder: parsed.manufacturingOrderNumber,
          totalDuration: 0,
          totalQuantity: 0,
          cycleCount: 0,
          operations: new Set()
        });
      }
      
      const data = aggregatedData.get(key)!;
      data.totalDuration += cycle.work_cycles_duration;
      data.totalQuantity += cycle.work_cycles_quantity_done || 1; // Default to 1 if no quantity specified
      data.cycleCount += 1;
      data.operations.add(parsed.operation);
    }
    
    console.log(`🔄 Aggregated ${allCycles.length} cycles into ${aggregatedData.size} operator+workCenter+MO combinations`);
    
    // Calculate UPH for each aggregated group
    const uphCalculations = [];
    for (const [key, data] of aggregatedData) {
      if (data.totalDuration <= 0 || data.totalQuantity <= 0) {
        continue;
      }
      
      const durationHours = data.totalDuration / 3600; // Convert seconds to hours
      const uph = data.totalQuantity / durationHours;
      
      // Filter realistic UPH values (between 1 and 500)
      if (uph >= 1 && uph <= 500) {
        uphCalculations.push({
          operatorName: data.operatorName,
          workCenter: data.workCenter,
          operation: Array.from(data.operations).join(', '), // Combined operations
          productRouting: data.manufacturingOrder,
          uph: Math.round(uph * 100) / 100, // Round to 2 decimal places
          observationCount: data.cycleCount,
          totalDurationHours: Math.round(durationHours * 100) / 100,
          totalQuantity: data.totalQuantity,
          dataSource: 'work_cycles_enhanced',
          calculationPeriod: 30
        });
      }
    }
    
    console.log(`📈 Generated ${uphCalculations.length} valid UPH calculations from enhanced rec_name aggregation`);
    
    // Clear existing enhanced UPH data
    await db.delete(uphData).where.dataSource?.eq('work_cycles_enhanced');
    
    // Insert new enhanced UPH calculations
    if (uphCalculations.length > 0) {
      await db.insert(uphData).values(uphCalculations);
      console.log(`✅ Stored ${uphCalculations.length} enhanced UPH calculations in database`);
    }
    
    // Return summary statistics
    const workCenterStats = uphCalculations.reduce((acc, calc) => {
      if (!acc[calc.workCenter]) {
        acc[calc.workCenter] = { count: 0, avgUph: 0, totalObs: 0 };
      }
      acc[calc.workCenter].count += 1;
      acc[calc.workCenter].avgUph += calc.uph;
      acc[calc.workCenter].totalObs += calc.observationCount;
      return acc;
    }, {} as Record<string, { count: number; avgUph: number; totalObs: number }>);
    
    // Calculate averages
    for (const wc in workCenterStats) {
      workCenterStats[wc].avgUph = Math.round((workCenterStats[wc].avgUph / workCenterStats[wc].count) * 100) / 100;
    }
    
    return {
      success: true,
      totalCyclesProcessed: allCycles.length,
      aggregatedGroups: aggregatedData.size,
      validUphCalculations: uphCalculations.length,
      workCenterStats,
      message: `Enhanced UPH calculation complete: ${uphCalculations.length} calculations stored using rec_name field aggregation`
    };
    
  } catch (error) {
    console.error("Enhanced UPH calculation failed:", error);
    throw error;
  }
}

/**
 * Get enhanced UPH statistics by work center
 */
export async function getEnhancedUPHStats() {
  try {
    const enhancedUph = await db.select()
      .from(uphData)
      .where.dataSource?.eq('work_cycles_enhanced');
    
    const stats = {
      totalCalculations: enhancedUph.length,
      byWorkCenter: {} as Record<string, { count: number; avgUph: number; operators: Set<string> }>,
      byOperator: {} as Record<string, { count: number; avgUph: number; workCenters: Set<string> }>
    };
    
    for (const calc of enhancedUph) {
      // Work center stats
      if (!stats.byWorkCenter[calc.workCenter]) {
        stats.byWorkCenter[calc.workCenter] = { count: 0, avgUph: 0, operators: new Set() };
      }
      stats.byWorkCenter[calc.workCenter].count += 1;
      stats.byWorkCenter[calc.workCenter].avgUph += calc.uph;
      stats.byWorkCenter[calc.workCenter].operators.add(calc.operatorName);
      
      // Operator stats
      if (!stats.byOperator[calc.operatorName]) {
        stats.byOperator[calc.operatorName] = { count: 0, avgUph: 0, workCenters: new Set() };
      }
      stats.byOperator[calc.operatorName].count += 1;
      stats.byOperator[calc.operatorName].avgUph += calc.uph;
      stats.byOperator[calc.operatorName].workCenters.add(calc.workCenter);
    }
    
    // Calculate averages and convert Sets to arrays
    const finalStats = {
      totalCalculations: stats.totalCalculations,
      byWorkCenter: {} as Record<string, { count: number; avgUph: number; operatorCount: number }>,
      byOperator: {} as Record<string, { count: number; avgUph: number; workCenterCount: number }>
    };
    
    for (const wc in stats.byWorkCenter) {
      finalStats.byWorkCenter[wc] = {
        count: stats.byWorkCenter[wc].count,
        avgUph: Math.round((stats.byWorkCenter[wc].avgUph / stats.byWorkCenter[wc].count) * 100) / 100,
        operatorCount: stats.byWorkCenter[wc].operators.size
      };
    }
    
    for (const op in stats.byOperator) {
      finalStats.byOperator[op] = {
        count: stats.byOperator[op].count,
        avgUph: Math.round((stats.byOperator[op].avgUph / stats.byOperator[op].count) * 100) / 100,
        workCenterCount: stats.byOperator[op].workCenters.size
      };
    }
    
    return finalStats;
    
  } catch (error) {
    console.error("Enhanced UPH stats retrieval failed:", error);
    throw error;
  }
}