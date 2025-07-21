import { calculateUnifiedUph } from './server/unified-uph-calculator.js';
import { db } from './server/db.js';
import { workCycles, historicalUph } from './shared/schema.js';

async function debugUphCalculations() {
  try {
    // Check raw work cycles data
    const sampleCycles = await db.select()
      .from(workCycles)
      .limit(5);
    
    console.log('Sample work cycles:', sampleCycles.map(c => ({
      operator: c.work_cycles_operator_rec_name,
      quantity: c.work_cycles_quantity_done,
      duration: c.work_cycles_duration,
      hasQuantity: c.work_cycles_quantity_done > 0
    })));
    
    // Run unified calculator
    console.log('\nRunning unified calculator...');
    const results = await calculateUnifiedUph();
    console.log(`Total results: ${results.length}`);
    
    // Show first few results
    console.log('\nFirst 3 results:', results.slice(0, 3).map(r => ({
      operator: r.operatorName,
      workCenter: r.workCenter,
      routing: r.routing,
      operation: r.operation,
      averageUph: r.averageUph,
      observations: r.observationCount,
      moCount: r.moDetails.length
    })));
    
    // Find any results with null/undefined averageUph
    const nullUphResults = results.filter(r => r.averageUph == null || isNaN(r.averageUph));
    console.log(`\nResults with null/NaN UPH: ${nullUphResults.length}`);
    if (nullUphResults.length > 0) {
      console.log('Sample null UPH results:', nullUphResults.slice(0, 3));
    }
    
    // Look for Austin Hernandez specifically
    const austinResults = results.filter(r => r.operatorName === 'Austin Hernandez');
    console.log(`\nAustin Hernandez results: ${austinResults.length}`);
    if (austinResults.length > 0) {
      console.log('Austin Hernandez UPH:', austinResults[0]);
    }
    
    // Check current historical UPH data
    const currentData = await db.select()
      .from(historicalUph)
      .limit(5);
    
    console.log('\nCurrent historical UPH data:', currentData.map(h => ({
      operator: h.operator,
      uph: h.unitsPerHour,
      observations: h.observations
    })));
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugUphCalculations();