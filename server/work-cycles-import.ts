import { db } from "./db.js";
import { historicalUph, workCycles } from "../shared/schema.js";
import { sql } from "drizzle-orm";

/**
 * Calculate UPH from work cycles data after import
 * This is called automatically after CSV import to recalculate all UPH values
 */
export async function calculateUphFromWorkCycles(): Promise<{
  success: boolean;
  calculations: any[];
  summary: {
    totalCycles: number;
    uniqueOperators: number;
    storedUph: number;
  };
}> {
  try {
    console.log("Starting UPH calculation from work cycles...");
    
    // Clear existing historical UPH data
    await db.delete(historicalUph);
    console.log("Cleared existing historical UPH data");
    
    // Use the core UPH calculator
    const { calculateCoreUph } = await import("./uph-core-calculator.js");
    const coreResults = await calculateCoreUph({ bypassDateFilter: true });
    
    console.log(`Core calculator returned ${coreResults.length} UPH results`);
    
    // Store results in historical UPH table
    let storedCount = 0;
    for (const result of coreResults) {
      try {
        await db.insert(historicalUph).values({
          operatorId: result.operatorId || null,
          operator: result.operatorName,
          routing: result.routing,
          operation: result.operation || 'Combined',
          workCenter: result.workCenter,
          totalQuantity: result.totalQuantity,
          totalHours: result.totalHours,
          unitsPerHour: result.unitsPerHour,
          observations: result.observations,
          dataSource: 'work_cycles_import',
          lastCalculated: new Date()
        });
        storedCount++;
      } catch (error) {
        console.error(`Error storing UPH for ${result.operatorName}:`, error);
      }
    }
    
    // Get summary statistics
    const totalCycles = await db.execute(sql`SELECT COUNT(*) as count FROM ${workCycles}`);
    const uniqueOperators = await db.execute(sql`
      SELECT COUNT(DISTINCT work_cycles_operator_rec_name) as count 
      FROM ${workCycles} 
      WHERE work_cycles_operator_rec_name IS NOT NULL
    `);
    
    return {
      success: true,
      calculations: coreResults,
      summary: {
        totalCycles: totalCycles.rows[0].count as number,
        uniqueOperators: uniqueOperators.rows[0].count as number,
        storedUph: storedCount
      }
    };
    
  } catch (error) {
    console.error("Error calculating UPH from work cycles:", error);
    return {
      success: false,
      calculations: [],
      summary: {
        totalCycles: 0,
        uniqueOperators: 0,
        storedUph: 0
      }
    };
  }
}