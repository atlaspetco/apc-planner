import { db } from "./db.js";
import { historicalUph } from "../shared/schema.js";
import { eq } from "drizzle-orm";
import { calculateUnifiedUph } from "./unified-uph-calculator.js";

async function rebuildHistoricalUph() {
  try {
    console.log('Starting historical UPH rebuild using unified calculator...');
    
    // Clear existing data
    await db.delete(historicalUph);
    console.log('Cleared existing historical UPH data');
    
    // Calculate all UPH values using unified methodology
    const calculations = await calculateUnifiedUph();
    console.log(`Calculated ${calculations.length} UPH values`);
    
    // Get all operators for ID mapping
    const { operators } = await import("../shared/schema.js");
    const allOperators = await db.select().from(operators);
    const operatorMap = new Map(allOperators.map(op => [op.name, op.id]));
    
    // Insert calculated values
    let inserted = 0;
    for (const calc of calculations) {
      const operatorId = operatorMap.get(calc.operatorName);
      
      if (!operatorId) {
        console.warn(`No operator ID found for: ${calc.operatorName}`);
        continue;
      }
      
      // Calculate total quantity and hours from MO details
      const totalQuantity = calc.moDetails.reduce((sum, mo) => sum + mo.quantity, 0);
      const totalHours = calc.moDetails.reduce((sum, mo) => sum + mo.durationHours, 0);
      
      await db.insert(historicalUph).values({
        operatorId,
        routing: calc.routing,
        operation: calc.operation, // Now using actual operation from unified calc
        operator: calc.operatorName,
        workCenter: calc.workCenter,
        totalQuantity,
        totalHours,
        unitsPerHour: calc.averageUph,
        observations: calc.observationCount,
        dataSource: 'unified-calculator-2025-07-19',
        lastCalculated: new Date()
      });
      
      inserted++;
    }
    
    console.log(`Successfully rebuilt historical UPH table with ${inserted} records`);
    console.log('Historical UPH rebuild complete!');
    
  } catch (error) {
    console.error('Error rebuilding historical UPH:', error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  rebuildHistoricalUph()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Failed to rebuild historical UPH:', error);
      process.exit(1);
    });
}

export { rebuildHistoricalUph };