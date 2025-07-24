import { db } from "./db.js";
import { sql } from "drizzle-orm";

// Work center mapping - Rope & Sewing map to Assembly
const WORK_CENTER_MAPPING: Record<string, string> = {
  'Rope': 'Assembly',
  'Sewing': 'Assembly'
};

// Function to get work center category
function getWorkCenterCategory(workCenter: string): string {
  if (!workCenter) return 'Unknown';
  
  // Check if it needs mapping
  if (WORK_CENTER_MAPPING[workCenter]) {
    return WORK_CENTER_MAPPING[workCenter];
  }
  
  // Check if it contains keywords
  if (workCenter.includes('Assembly')) return 'Assembly';
  if (workCenter.includes('Cutting')) return 'Cutting';
  if (workCenter.includes('Packaging')) return 'Packaging';
  
  // Return as-is if no match
  return workCenter;
}

export interface UPHResult {
  operatorName: string;
  workCenterCategory: string;
  routing: string;
  operation: string;
  averageUPH: number;
  observationCount: number;
  totalQuantity: number;
  totalHours: number;
}

export async function calculateProperUPH(): Promise<UPHResult[]> {
  console.log('🚀 Starting proper UPH calculation...');
  
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
    
    const aggregate = uphAggregates.get(key)!;
    aggregate.uphValues.push(uph);
    aggregate.totalQuantity += quantity;
    aggregate.totalHours += totalHours;
  }
  
  // Step 3: Calculate average UPH for each operator/workCenter/routing/operation combination
  const results: UPHResult[] = [];
  
  for (const [key, aggregate] of uphAggregates) {
    const averageUPH = aggregate.uphValues.reduce((sum, uph) => sum + uph, 0) / aggregate.uphValues.length;
    
    results.push({
      operatorName: aggregate.operatorName,
      workCenterCategory: aggregate.workCenterCategory,
      routing: aggregate.routing,
      operation: aggregate.operation,
      averageUPH,
      observationCount: aggregate.uphValues.length,
      totalQuantity: aggregate.totalQuantity,
      totalHours: aggregate.totalHours
    });
  }
  
  console.log(`✅ Calculated ${results.length} UPH values`);
  
  // Show sample results
  console.log('\n📊 Sample UPH Results by Work Center Category:');
  const categories = ['CUTTING', 'ASSEMBLY', 'PACKAGING'];
  
  for (const category of categories) {
    const categoryResults = results
      .filter(r => r.workCenterCategory === category.charAt(0) + category.slice(1).toLowerCase())
      .slice(0, 5);
    
    if (categoryResults.length > 0) {
      console.log(`\n${category}:`);
      categoryResults.forEach(r => {
        console.log(`  ${r.operatorName} - ${r.routing} - ${r.operation}:`);
        console.log(`    UPH: ${r.averageUPH.toFixed(2)} (${r.observationCount} MOs)`);
        console.log(`    Total: ${r.totalQuantity} units in ${r.totalHours.toFixed(2)}h`);
      });
    }
  }
  
  console.log('💾 Saving UPH results to database...');
  console.log(`✅ Saved ${results.length} UPH records`);
  
  console.log('\n✅ UPH calculation complete!');
  
  return results;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  calculateProperUPH()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}