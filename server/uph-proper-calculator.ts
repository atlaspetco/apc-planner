import { db } from './db.js';
import { sql } from 'drizzle-orm';

/**
 * Proper UPH Calculation following exact business logic:
 * 
 * 1. Group work cycles by MO + Work Center Category
 * 2. Sum durations within each group
 * 3. Convert seconds to hours
 * 4. Calculate UPH = Production Quantity / Total Hours
 * 5. Group results by Operator + Work Center Category + Routing + Operation
 * 
 * Work Center Mapping:
 * - Rope, Sewing → Assembly
 * - Cutting → Cutting
 * - Packaging → Packaging
 */

interface WorkCycleGroup {
  moNumber: string;
  operatorName: string;
  workCenterCategory: string;
  routing: string;
  operation: string;
  productionQuantity: number;
  totalDurationSeconds: number;
  cycleCount: number;
}

interface UPHResult {
  operatorName: string;
  workCenterCategory: string;
  routing: string;
  operation: string;
  averageUPH: number;
  observationCount: number; // Number of MOs
  totalQuantity: number;
  totalHours: number;
}

/**
 * Map work center names to categories
 */
function getWorkCenterCategory(workCenter: string): string {
  if (!workCenter) return 'Unknown';
  
  const wcLower = workCenter.toLowerCase();
  
  // Check for Assembly-related work centers
  if (wcLower.includes('rope') || wcLower.includes('sewing')) {
    return 'Assembly';
  }
  
  // Check for Cutting
  if (wcLower.includes('cutting')) {
    return 'Cutting';
  }
  
  // Check for Packaging
  if (wcLower.includes('packaging')) {
    return 'Packaging';
  }
  
  // Check for explicit Assembly
  if (wcLower.includes('assembly')) {
    return 'Assembly';
  }
  
  // Default to original if no match
  return workCenter;
}

async function calculateProperUPH(): Promise<UPHResult[]> {
  console.log("🚀 Starting proper UPH calculation...");
  
  // Step 1: Get all work cycles grouped by MO + Work Center
  const query = sql`
    SELECT 
      work_production_number as mo_number,
      work_cycles_operator_rec_name as operator_name,
      work_cycles_work_center_rec_name as work_center,
      work_production_routing_rec_name as routing,
      work_operation_rec_name as operation,
      MAX(COALESCE(work_production_quantity, work_cycles_quantity_done)) as production_quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count
    FROM work_cycles
    WHERE 
      work_cycles_duration > 0
      AND work_production_number IS NOT NULL
      AND work_cycles_operator_rec_name IS NOT NULL
      AND data_corrupted = FALSE
    GROUP BY 
      work_production_number,
      work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name,
      work_production_routing_rec_name,
      work_operation_rec_name
  `;
  
  const workCycleGroups = await db.execute(query);
  
  console.log(`📊 Found ${workCycleGroups.rows.length} MO/Operator/WorkCenter groups`);
  
  // Step 2: Calculate UPH for each group and map to categories
  const uphByMO = new Map<string, number>();
  const groupKey = (row: any) => 
    `${row.operator_name}|${getWorkCenterCategory(row.work_center)}|${row.routing}|${row.operation}`;
  
  const uphAggregates = new Map<string, {
    operatorName: string;
    workCenterCategory: string;
    routing: string;
    operation: string;
    uphValues: number[];
    totalQuantity: number;
    totalHours: number;
  }>();
  
  for (const row of workCycleGroups.rows) {
    const workCenterCategory = getWorkCenterCategory(row.work_center as string);
    const totalHours = (row.total_duration_seconds as number) / 3600;
    const quantity = row.production_quantity as number;
    
    if (totalHours <= 0 || quantity <= 0) continue;
    
    const uph = quantity / totalHours;
    
    // Store UPH for this MO
    const moKey = `${row.mo_number}|${row.operator_name}|${workCenterCategory}`;
    uphByMO.set(moKey, uph);
    
    // Aggregate by operator/workCenter/routing/operation
    const key = groupKey({
      ...row,
      work_center: workCenterCategory
    });
    
    if (!uphAggregates.has(key)) {
      uphAggregates.set(key, {
        operatorName: row.operator_name as string,
        workCenterCategory,
        routing: row.routing as string || 'Unknown',
        operation: row.operation as string || 'Unknown',
        uphValues: [],
        totalQuantity: 0,
        totalHours: 0
      });
    }
    
    const agg = uphAggregates.get(key)!;
    agg.uphValues.push(uph);
    agg.totalQuantity += quantity;
    agg.totalHours += totalHours;
  }
  
  // Step 3: Calculate average UPH for each group
  const results: UPHResult[] = [];
  
  for (const [key, agg] of uphAggregates) {
    if (agg.uphValues.length === 0) continue;
    
    // Calculate average UPH across all MOs for this combination
    const averageUPH = agg.uphValues.reduce((sum, val) => sum + val, 0) / agg.uphValues.length;
    
    results.push({
      operatorName: agg.operatorName,
      workCenterCategory: agg.workCenterCategory,
      routing: agg.routing,
      operation: agg.operation,
      averageUPH: Math.round(averageUPH * 100) / 100, // Round to 2 decimal places
      observationCount: agg.uphValues.length,
      totalQuantity: agg.totalQuantity,
      totalHours: Math.round(agg.totalHours * 100) / 100
    });
  }
  
  // Sort results for better readability
  results.sort((a, b) => {
    if (a.routing !== b.routing) return a.routing.localeCompare(b.routing);
    if (a.workCenterCategory !== b.workCenterCategory) return a.workCenterCategory.localeCompare(b.workCenterCategory);
    if (a.operatorName !== b.operatorName) return a.operatorName.localeCompare(b.operatorName);
    return a.operation.localeCompare(b.operation);
  });
  
  console.log(`✅ Calculated ${results.length} UPH values`);
  
  return results;
}

async function saveUPHResults(results: UPHResult[]): Promise<void> {
  console.log("💾 Saving UPH results to database...");
  
  // Clear existing data
  await db.execute(sql`DELETE FROM uph_data WHERE data_source = 'work_cycles'`);
  
  // Get operator IDs
  const operators = await db.execute(sql`SELECT id, name FROM operators`);
  const operatorMap = new Map(operators.rows.map(op => [op.name as string, op.id as number]));
  
  let savedCount = 0;
  
  for (const result of results) {
    const operatorId = operatorMap.get(result.operatorName);
    if (!operatorId) {
      console.log(`⚠️  No operator ID found for: ${result.operatorName}`);
      continue;
    }
    
    try {
      await db.execute(sql`
        INSERT INTO uph_data (
          operator_id,
          operator_name,
          work_center,
          operation,
          product_routing,
          uph,
          observation_count,
          total_duration_hours,
          total_quantity,
          data_source,
          calculation_period
        ) VALUES (
          ${operatorId},
          ${result.operatorName},
          ${result.workCenterCategory},
          ${result.operation},
          ${result.routing},
          ${result.averageUPH},
          ${result.observationCount},
          ${result.totalHours},
          ${result.totalQuantity},
          'work_cycles',
          30
        )
      `);
      
      savedCount++;
    } catch (error) {
      console.error(`❌ Error saving UPH for ${result.operatorName}:`, error);
    }
  }
  
  console.log(`✅ Saved ${savedCount} UPH records`);
}

async function displaySampleResults(results: UPHResult[]): Promise<void> {
  console.log("\n📊 Sample UPH Results by Work Center Category:");
  
  const categories = ['Cutting', 'Assembly', 'Packaging'];
  
  for (const category of categories) {
    const categoryResults = results.filter(r => r.workCenterCategory === category);
    
    if (categoryResults.length === 0) continue;
    
    console.log(`\n${category.toUpperCase()}:`);
    
    // Show top 5 by observation count
    const top5 = categoryResults
      .sort((a, b) => b.observationCount - a.observationCount)
      .slice(0, 5);
    
    for (const result of top5) {
      console.log(`  ${result.operatorName} - ${result.routing} - ${result.operation}:`);
      console.log(`    UPH: ${result.averageUPH} (${result.observationCount} MOs)`);
      console.log(`    Total: ${result.totalQuantity} units in ${result.totalHours}h`);
    }
  }
}

async function main() {
  try {
    // Calculate UPH
    const results = await calculateProperUPH();
    
    // Display sample results
    await displaySampleResults(results);
    
    // Save to database
    await saveUPHResults(results);
    
    console.log("\n✅ UPH calculation complete!");
    
  } catch (error) {
    console.error("❌ Error calculating UPH:", error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { calculateProperUPH, getWorkCenterCategory };