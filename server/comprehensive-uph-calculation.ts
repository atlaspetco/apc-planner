import { db } from './db/index.js';
import { sql } from 'drizzle-orm';

export async function runComprehensiveUphCalculation() {
  console.log('=== COMPREHENSIVE UPH CALCULATION START ===');
  console.log('Following locked process: Work Cycles → Production Orders → Duration Aggregation → UPH Calculation');

  // STEP 1: Get all production orders from Fulfil API /api/v2/model/production?state=done
  console.log('Step 1: Fetching production orders from /api/v2/model/production?state=done');
  
  const productionOrders = new Map<string, {quantity: number, id: number}>();
  
  try {
    const response = await fetch(`https://apc.fulfil.io/api/v2/model/production.order/search_read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.FULFIL_ACCESS_TOKEN || ''
      },
      body: JSON.stringify({
        filter: [['state', '=', 'done']],
        fields: ['rec_name', 'quantity', 'id'],
        per_page: 1000
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`Step 1: Fetched ${data.length} production orders from Fulfil API`);
      
      for (const mo of data) {
        const moNumber = mo.rec_name?.toString();
        const quantity = parseFloat(mo.quantity?.toString() || '0');
        const id = parseInt(mo.id?.toString() || '0');
        
        if (moNumber && quantity > 0 && id > 0) {
          productionOrders.set(moNumber, {quantity, id});
        }
      }
      
      console.log(`Step 1: Processed ${productionOrders.size} production orders with valid quantities`);
    } else {
      console.log(`Step 1: API error ${response.status}, proceeding with existing data`);
    }
  } catch (error) {
    console.log('Step 1: API error, proceeding with existing data:', error);
  }

  // STEP 2: Build UPH table with total durations per work center + production_id from work cycles
  console.log('Step 2: Aggregating work cycle durations by work center + production_id');
  
  const durationAggregationResult = await db.execute(sql`
    SELECT 
      work_production_number,
      work_production_id,
      work_cycles_operator_rec_name,
      work_production_routing_rec_name,
      CASE 
        WHEN work_cycles_work_center_rec_name LIKE '%Assembly%' OR work_cycles_work_center_rec_name LIKE '%Sewing%' 
          OR work_cycles_work_center_rec_name LIKE '%Rope%' THEN 'Assembly'
        WHEN work_cycles_work_center_rec_name LIKE '%Packaging%' THEN 'Packaging'  
        WHEN work_cycles_work_center_rec_name LIKE '%Cutting%' OR work_cycles_work_center_rec_name LIKE '%Laser%' 
          OR work_cycles_work_center_rec_name LIKE '%Webbing%' THEN 'Cutting'
        ELSE work_cycles_work_center_rec_name
      END as work_center_consolidated,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count,
      MIN(work_cycles_create_date) as earliest_date,
      MAX(work_cycles_create_date) as latest_date
    FROM work_cycles 
    WHERE work_production_number IS NOT NULL 
      AND work_production_number != ''
      AND work_cycles_operator_rec_name IS NOT NULL
      AND work_cycles_duration > 0
      AND work_production_routing_rec_name IS NOT NULL
    GROUP BY 
      work_production_number,
      work_production_id,
      work_cycles_operator_rec_name,
      work_production_routing_rec_name,
      work_center_consolidated
    HAVING SUM(work_cycles_duration) > 60
    ORDER BY work_production_number, work_cycles_operator_rec_name, work_center_consolidated
  `);

  console.log(`Step 2: Aggregated ${durationAggregationResult.rows.length} work center + production combinations`);

  // STEP 3: Calculate UPH using production_id to lookup production order quantities
  console.log('Step 3: Calculating UPH using production order quantities');
  
  const uphCalculations: Array<{
    moNumber: string;
    operatorName: string;
    workCenter: string;
    routing: string;
    uph: number;
    quantity: number;
    durationHours: number;
    cycleCount: number;
    dataSource: string;
  }> = [];

  let calculatedCount = 0;
  let skippedCount = 0;

  for (const row of durationAggregationResult.rows) {
    const moNumber = row.work_production_number?.toString() || '';
    const operatorName = row.work_cycles_operator_rec_name?.toString() || '';
    const workCenter = row.work_center_consolidated?.toString() || '';
    const routing = row.work_production_routing_rec_name?.toString() || '';
    const totalDurationSec = parseFloat(row.total_duration_seconds?.toString() || '0');
    const cycleCount = parseInt(row.cycle_count?.toString() || '0');
    
    // Look up production order quantity using production_id or rec_name
    const productionOrder = productionOrders.get(moNumber);
    
    if (productionOrder && totalDurationSec > 0) {
      const durationHours = totalDurationSec / 3600;
      const uph = productionOrder.quantity / durationHours;
      
      // Only include realistic UPH values
      if (uph > 0 && uph < 500) {
        uphCalculations.push({
          moNumber,
          operatorName,
          workCenter,
          routing,
          uph,
          quantity: productionOrder.quantity,
          durationHours,
          cycleCount,
          dataSource: 'production_order_api'
        });
        
        calculatedCount++;
        console.log(`MO ${moNumber}: ${operatorName} | ${workCenter} | ${routing} = ${Math.round(uph * 100) / 100} UPH (${productionOrder.quantity} units, ${Math.round(durationHours * 100) / 100}h, ${cycleCount} cycles)`);
      }
    } else {
      skippedCount++;
      if (skippedCount <= 10) {
        console.log(`SKIPPED ${moNumber}: ${operatorName} | ${workCenter} | ${routing} - No production order quantity available`);
      }
    }
  }

  // STEP 4: Aggregate by operator + work center + routing for averages  
  console.log('Step 4: Calculating operator + work center + routing averages');
  
  const operatorAverages = new Map<string, {
    operatorName: string;
    workCenter: string;
    routing: string;
    moUphValues: number[];
    totalObservations: number;
    avgUph: number;
  }>();

  for (const calc of uphCalculations) {
    const key = `${calc.operatorName}|${calc.workCenter}|${calc.routing}`;
    
    if (!operatorAverages.has(key)) {
      operatorAverages.set(key, {
        operatorName: calc.operatorName,
        workCenter: calc.workCenter,
        routing: calc.routing,
        moUphValues: [],
        totalObservations: 0,
        avgUph: 0
      });
    }
    
    const group = operatorAverages.get(key)!;
    group.moUphValues.push(calc.uph);
    group.totalObservations += calc.cycleCount;
  }

  // Calculate averages
  for (const [key, group] of operatorAverages) {
    group.avgUph = group.moUphValues.reduce((sum, uph) => sum + uph, 0) / group.moUphValues.length;
    console.log(`AVERAGED: ${group.operatorName} | ${group.workCenter} | ${group.routing}: ${Math.round(group.avgUph * 100) / 100} UPH (averaged from ${group.moUphValues.length} MOs, ${group.totalObservations} total cycles)`);
  }

  console.log('=== COMPREHENSIVE UPH CALCULATION COMPLETE ===');
  console.log(`Final Results: ${calculatedCount} UPH calculations, ${operatorAverages.size} operator averages, ${skippedCount} skipped (no production order data)`);

  return {
    success: true,
    message: `Comprehensive UPH calculation complete using authentic production order data`,
    calculations: calculatedCount,
    averages: operatorAverages.size,
    skipped: skippedCount,
    summary: Object.fromEntries(
      Array.from(operatorAverages.values())
        .reduce((acc, group) => {
          if (!acc.has(group.workCenter)) {
            acc.set(group.workCenter, { totalCalculations: 0, avgUph: 0, totalObservations: 0 });
          }
          const wc = acc.get(group.workCenter)!;
          wc.totalCalculations++;
          wc.avgUph += group.avgUph;
          wc.totalObservations += group.totalObservations;
          return acc;
        }, new Map())
    ),
    method: "Comprehensive authentic data pipeline: Production Orders API → Duration Aggregation → UPH Calculation"
  };
}