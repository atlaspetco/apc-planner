import { db } from "./db.js";
import { workCycles, operators, uphData, uphCalculationData } from "../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Fix UPH calculations with correct observation counts
 * Recalculates all UPH data using actual work cycle counts as observations
 */
export async function fixUphObservations() {
  try {
    console.log("Starting UPH observation count fix...");
    
    // Work center consolidation function
    const consolidateWorkCenter = (rawWorkCenter: string): string => {
      if (!rawWorkCenter) return 'Unknown';
      const wc = rawWorkCenter.toLowerCase();
      if (wc.includes('cutting') || wc.includes('cut') || wc.includes('laser') || wc.includes('webbing')) {
        return 'Cutting';
      } else if (wc.includes('sewing') || wc.includes('assembly') || wc.includes('rope') || wc.includes('embroidery')) {
        return 'Assembly';
      } else if (wc.includes('packaging') || wc.includes('pack')) {
        return 'Packaging';
      }
      return rawWorkCenter; // Keep original if no match
    };

    // Get UPH calculations from aggregated data instead of raw work cycles
    const aggregatedData = await db.select().from(uphCalculationData);
    
    console.log(`Found ${aggregatedData.length} aggregated work cycle groups`);
    
    // Group by operator/routing/work center for UPH calculation
    const uphMap = new Map<string, {
      operator: string;
      routing: string;
      workCenter: string;
      totalQuantity: number;
      totalDuration: number;
      observationCount: number;
    }>();
    
    for (const data of aggregatedData) {
      // Apply work center consolidation to match the aggregated data structure
      const consolidatedWorkCenter = consolidateWorkCenter(data.workCenter);
      const key = `${data.operatorName}-${data.routing}-${consolidatedWorkCenter}`;
      
      if (!uphMap.has(key)) {
        uphMap.set(key, {
          operator: data.operatorName || '',
          routing: data.routing,
          workCenter: consolidatedWorkCenter,
          totalQuantity: 0,
          totalDuration: 0,
          observationCount: 0
        });
      }
      
      const entry = uphMap.get(key)!;
      // Only include records with positive quantity to exclude setup/downtime periods
      if ((data.totalQuantityDone || 0) > 0) {
        entry.totalQuantity += data.totalQuantityDone || 0;
        entry.totalDuration += data.totalDurationSeconds;
        entry.observationCount += data.cycleCount;
      }
    }
    
    // Filter out entries with zero quantities after aggregation
    const validRows = Array.from(uphMap.values()).filter(row => 
      row.totalQuantity > 0 && row.totalDuration > 0 && row.observationCount > 0
    );
    
    console.log(`Found ${validRows.length} valid operator/routing/work center combinations (${uphMap.size - validRows.length} filtered out due to zero quantities)`);
    
    // Calculate UPH with correct observations
    const calculations = validRows.map((row) => {
      const totalQuantity = row.totalQuantity;
      const totalDurationHours = row.totalDuration / 3600;
      const unitsPerHour = totalDurationHours > 0 ? totalQuantity / totalDurationHours : 0;
      const observationCount = row.observationCount;
      
      return {
        operator: row.operator,
        routing: row.routing,
        workCenter: row.workCenter,
        operation: 'Combined',
        unitsPerHour: Math.round(unitsPerHour * 100) / 100,
        observations: observationCount,
        totalQuantity,
        totalHours: Math.round(totalDurationHours * 100) / 100
      };
    }).filter(calc => 
      calc.unitsPerHour > 0 && 
      calc.unitsPerHour < 500 && 
      calc.observations >= 1
    );
    
    console.log(`Generated ${calculations.length} valid UPH calculations`);
    
    // Get operator name-to-ID mapping
    const allOperators = await db.select().from(operators);
    const operatorNameToId = new Map<string, number>();
    allOperators.forEach(op => operatorNameToId.set(op.name, op.id));
    
    // Clear existing UPH data
    await db.delete(uphData);
    console.log("Cleared existing UPH data");
    
    // Insert corrected calculations
    let stored = 0;
    for (const calc of calculations) {
      const operatorId = operatorNameToId.get(calc.operator);
      if (operatorId) {
        await db.insert(uphData).values({
          routing: calc.routing,
          workCenter: calc.workCenter,
          operation: calc.operation,
          operatorId: operatorId,
          unitsPerHour: calc.unitsPerHour,
          calculationPeriod: calc.observations // Store actual observation count
        });
        stored++;
      }
    }
    
    console.log(`Stored ${stored} corrected UPH calculations with authentic observation counts`);
    
    return {
      success: true,
      message: `Fixed UPH calculations for ${stored} combinations with authentic observation counts`,
      calculations: calculations.slice(0, 10), // Sample for verification
      totalStored: stored
    };
    
  } catch (error) {
    console.error("Error fixing UPH observations:", error);
    return {
      success: false,
      message: `Error fixing UPH observations: ${error instanceof Error ? error.message : 'Unknown error'}`,
      calculations: [],
      totalStored: 0
    };
  }
}