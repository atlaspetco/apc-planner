import { DatabaseStorage } from './storage.js';

/**
 * Final Comprehensive UPH Calculation using exact Fulfil API endpoints
 * Process: GET /model/production.work/cycles?state=done → GET /model/production?state=done → UPH Calculation
 */
export async function runFinalComprehensiveUphCalculation() {
  console.log('=== COMPREHENSIVE UPH CALCULATION START ===');
  console.log('Following locked process: Work Cycles → Production Orders → Duration Aggregation → UPH Calculation');
  console.log('Step 1: GET /model/production.work/cycles?state=done');
  console.log('Step 2: GET /model/production?state=done'); 
  console.log('Step 3: Calculate UPH = quantity ÷ (total_duration ÷ 3600)');

  // Import Fulfil API client
  const { FulfilAPIService } = await import('./fulfil-api.js');
  const storage = new DatabaseStorage();
  const fulfil = new FulfilAPIService();

  try {
    // Step 1: Fetch work cycles from Fulfil API using your specified endpoint
    console.log('Step 1: Fetching work cycles from GET /model/production.work/cycles?state=done');
    
    const workCycles = await fulfil.getWorkCycles();
    
    if (!workCycles || workCycles.length === 0) {
      console.log('No work cycles from API, falling back to database calculation');
      return await runDatabaseFallbackCalculation();
    }
    
    console.log(`Step 1: Fetched ${workCycles.length} work cycles from Fulfil API`);
    
    // Step 2: Fetch production orders from Fulfil API
    console.log('Step 2: Fetching production orders from GET /model/production?state=done');
    
    const productionOrders = await fulfil.getProductionOrders();
    
    if (!productionOrders || productionOrders.length === 0) {
      console.log('No production orders from API, falling back to database calculation');
      return await runDatabaseFallbackCalculation();
    }
    
    console.log(`Step 2: Fetched ${productionOrders.length} production orders from Fulfil API`);
    
    // Step 3: Build production order lookup map
    const productionMap = new Map();
    for (const po of productionOrders) {
      productionMap.set(po.id, {
        number: po.rec_name,
        quantity: po.quantity,
        routing: po.routing?.name || 'Unknown Routing'
      });
    }
    
    // Step 4: Aggregate work cycle durations by production order + operator + work center
    const aggregations = new Map();
    
    for (const cycle of workCycles) {
      if (!cycle.production?.id || !cycle.operator?.rec_name || !cycle.work_center?.rec_name) {
        continue;
      }
      
      const production = productionMap.get(cycle.production.id);
      if (!production) continue;
      
      // Work center consolidation
      let workCenter = cycle.work_center.rec_name;
      if (workCenter.includes('Assembly') || workCenter.includes('Sewing') || workCenter.includes('Rope')) {
        workCenter = 'Assembly';
      } else if (workCenter.includes('Packaging')) {
        workCenter = 'Packaging';
      } else if (workCenter.includes('Cutting') || workCenter.includes('Laser') || workCenter.includes('Webbing')) {
        workCenter = 'Cutting';
      }
      
      const key = `${production.number}|${cycle.operator.rec_name}|${workCenter}|${production.routing}`;
      
      if (!aggregations.has(key)) {
        aggregations.set(key, {
          productionNumber: production.number,
          operator: cycle.operator.rec_name,
          workCenter,
          routing: production.routing,
          quantity: production.quantity,
          totalDuration: 0,
          cycleCount: 0
        });
      }
      
      const agg = aggregations.get(key);
      agg.totalDuration += cycle.duration || 0;
      agg.cycleCount += 1;
    }
    
    // Step 5: Calculate UPH for each aggregation
    const uphCalculations = [];
    
    for (const [key, agg] of aggregations) {
      if (agg.totalDuration > 120 && agg.quantity > 0) { // Minimum 2 minutes
        const totalHours = agg.totalDuration / 3600;
        const uph = agg.quantity / totalHours;
        
        if (uph > 0.5 && uph < 1000) { // Realistic UPH range
          uphCalculations.push({
            productionOrder: agg.productionNumber,
            operator: agg.operator,
            workCenter: agg.workCenter,
            routing: agg.routing,
            uph: Math.round(uph * 100) / 100,
            quantity: agg.quantity,
            totalHours: Math.round(totalHours * 100) / 100,
            cycleCount: agg.cycleCount
          });
        }
      }
    }
    
    // Step 6: Average by operator + work center + routing
    const finalGrouping = new Map();
    for (const calc of uphCalculations) {
      const key = `${calc.operator}|${calc.workCenter}|${calc.routing}`;
      
      if (!finalGrouping.has(key)) {
        finalGrouping.set(key, {
          operator: calc.operator,
          workCenter: calc.workCenter,
          routing: calc.routing,
          uphValues: [],
          moCount: 0,
          totalCycles: 0
        });
      }
      
      const group = finalGrouping.get(key);
      group.uphValues.push(calc.uph);
      group.moCount += 1;
      group.totalCycles += calc.cycleCount;
    }
    
    const finalResults = [];
    for (const [key, group] of finalGrouping) {
      const avgUph = group.uphValues.reduce((sum, uph) => sum + uph, 0) / group.uphValues.length;
      finalResults.push({
        operator: group.operator,
        workCenter: group.workCenter,
        routing: group.routing,
        averageUph: Math.round(avgUph * 100) / 100,
        moCount: group.moCount,
        totalCycles: group.totalCycles
      });
    }
    
    finalResults.sort((a, b) => a.operator.localeCompare(b.operator));
    
    console.log('\n=== FULFIL API RESULTS ===');
    for (const result of finalResults) {
      console.log(`API: ${result.operator} | ${result.workCenter} | ${result.routing}: ${result.averageUph} UPH (${result.moCount} MOs, ${result.totalCycles} cycles)`);
    }
    
    return {
      success: true,
      totalCalculations: finalResults.length,
      totalMOs: uphCalculations.length,
      workCyclesProcessed: workCycles.length,
      results: finalResults,
      method: 'Fulfil API - Work Cycles → Production Orders → UPH Calculation',
      dataSource: 'Live Fulfil API endpoints'
    };
    
  } catch (error) {
    console.error('Fulfil API failed, falling back to database:', error);
    return await runDatabaseFallbackCalculation();
  }
}

/**
 * Database fallback when Fulfil API is unavailable
 */
async function runDatabaseFallbackCalculation() {
  console.log('\n=== DATABASE FALLBACK CALCULATION ===');
  const storage = new DatabaseStorage();
  
  // Get work cycles data from database
  const workCyclesData = await storage.getWorkCycles();
  
  if (workCyclesData.length === 0) {
    return {
      success: false,
      error: 'No work cycles data available in database or Fulfil API',
      totalCalculations: 0
    };
  }
  
  console.log(`Database fallback: Processing ${workCyclesData.length} work cycles`);
  
  // Group by production order + operator + work center + routing
  const moGroupings = new Map();
  
  for (const cycle of workCyclesData) {
    if (!cycle.workProductionNumber || !cycle.workCyclesOperatorRecName || !cycle.workCyclesWorkCenterRecName) {
      continue;
    }
    
    // Work center consolidation
    let workCenter = cycle.workCyclesWorkCenterRecName;
    if (workCenter.includes('Assembly') || workCenter.includes('Sewing') || workCenter.includes('Rope')) {
      workCenter = 'Assembly';
    } else if (workCenter.includes('Packaging')) {
      workCenter = 'Packaging';
    } else if (workCenter.includes('Cutting') || workCenter.includes('Laser') || workCenter.includes('Webbing')) {
      workCenter = 'Cutting';
    }
    
    const routing = cycle.workProductionRoutingRecName || 'Unknown Routing';
    const key = `${cycle.workProductionNumber}|${cycle.workCyclesOperatorRecName}|${workCenter}|${routing}`;
    
    if (!moGroupings.has(key)) {
      moGroupings.set(key, {
        productionOrder: cycle.workProductionNumber,
        operator: cycle.workCyclesOperatorRecName,
        workCenter,
        routing,
        totalDuration: 0,
        quantity: cycle.workCyclesQuantityDone || 1,
        cycleCount: 0
      });
    }
    
    const group = moGroupings.get(key);
    group.totalDuration += cycle.workCyclesDuration || 0;
    group.cycleCount += 1;
  }
  
  // Calculate UPH for each production order
  const moUphCalculations = [];
  
  for (const [key, group] of moGroupings) {
    if (group.totalDuration > 120 && group.quantity > 0) {
      const totalHours = group.totalDuration / 3600;
      const uph = group.quantity / totalHours;
      
      if (uph > 0.5 && uph < 1000) {
        moUphCalculations.push({
          productionOrder: group.productionOrder,
          operator: group.operator,
          workCenter: group.workCenter,
          routing: group.routing,
          uph: Math.round(uph * 100) / 100,
          cycleCount: group.cycleCount
        });
      }
    }
  }
  
  // Average by operator + work center + routing
  const finalGrouping = new Map();
  for (const calc of moUphCalculations) {
    const key = `${calc.operator}|${calc.workCenter}|${calc.routing}`;
    
    if (!finalGrouping.has(key)) {
      finalGrouping.set(key, {
        operator: calc.operator,
        workCenter: calc.workCenter,
        routing: calc.routing,
        uphValues: [],
        moCount: 0,
        totalCycles: 0
      });
    }
    
    const group = finalGrouping.get(key);
    group.uphValues.push(calc.uph);
    group.moCount += 1;
    group.totalCycles += calc.cycleCount;
  }
  
  const finalResults = [];
  for (const [key, group] of finalGrouping) {
    const avgUph = group.uphValues.reduce((sum, uph) => sum + uph, 0) / group.uphValues.length;
    finalResults.push({
      operator: group.operator,
      workCenter: group.workCenter,
      routing: group.routing,
      averageUph: Math.round(avgUph * 100) / 100,
      moCount: group.moCount,
      totalCycles: group.totalCycles
    });
  }
  
  finalResults.sort((a, b) => a.operator.localeCompare(b.operator));
  
  console.log('\n=== DATABASE FALLBACK RESULTS ===');
  for (const result of finalResults) {
    console.log(`${result.operator} | ${result.workCenter} | ${result.routing}: ${result.averageUph} UPH (${result.moCount} MOs, ${result.totalCycles} cycles)`);
  }
  
  return {
    success: true,
    totalCalculations: finalResults.length,
    totalMOs: moUphCalculations.length,
    workCyclesProcessed: workCyclesData.length,
    results: finalResults,
    method: 'Database fallback - Work Cycles → UPH Calculation',
    dataSource: 'Existing work_cycles table'
  };
}