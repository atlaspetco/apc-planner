import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { eq, and, sql, like } from 'drizzle-orm';

async function checkPouchUPH() {
  // Check specific MO20881 that user mentioned
  console.log('=== Checking MO20881 Work Cycles ===\n');
  
  const mo20881Cycles = await db.select({
    moNumber: workCycles.work_production_number,
    woNumber: workCycles.work_id,
    operation: workCycles.work_operation_rec_name,
    workCenter: workCycles.work_cycles_work_center_rec_name,
    operator: workCycles.work_cycles_operator_rec_name,
    duration: workCycles.work_cycles_duration,
    quantity: workCycles.work_production_quantity,
    routing: workCycles.work_production_routing_rec_name
  }).from(workCycles)
    .where(eq(workCycles.work_production_number, 'MO20881'));

  console.log(`Found ${mo20881Cycles.length} work cycles for MO20881\n`);
  
  // Group by work center
  const workCenterGroups = mo20881Cycles.reduce((acc, cycle) => {
    const wc = cycle.workCenter || 'Unknown';
    if (!acc[wc]) {
      acc[wc] = {
        cycles: [],
        totalDuration: 0,
        operators: new Set<string>()
      };
    }
    acc[wc].cycles.push(cycle);
    acc[wc].totalDuration += cycle.duration || 0;
    if (cycle.operator) acc[wc].operators.add(cycle.operator);
    return acc;
  }, {} as Record<string, { cycles: typeof mo20881Cycles, totalDuration: number, operators: Set<string> }>);
  
  // Get production order quantity
  const mo = await db.select().from(productionOrders)
    .where(eq(productionOrders.moNumber, 'MO20881'))
    .limit(1);
  
  const productionQty = mo[0]?.quantity || mo20881Cycles[0]?.quantity || 0;
  
  console.log(`Production Order Quantity: ${productionQty} units`);
  console.log(`Routing: ${mo[0]?.routing || mo20881Cycles[0]?.routing || 'Unknown'}\n`);
  
  // Display by work center
  Object.entries(workCenterGroups).forEach(([workCenter, data]) => {
    console.log(`\n${workCenter.toUpperCase()} Work Center:`);
    console.log('------------------------');
    
    data.cycles.forEach(c => {
      console.log(`  WO${c.woNumber}: ${c.operation} - ${c.duration}s (${c.operator})`);
    });
    
    const totalHours = data.totalDuration / 3600;
    const uph = productionQty / totalHours;
    
    console.log(`\n  Total Duration: ${data.totalDuration}s = ${totalHours.toFixed(2)} hours`);
    console.log(`  Operators: ${Array.from(data.operators).join(', ')}`);
    console.log(`  UPH for ${workCenter}: ${productionQty} / ${totalHours.toFixed(2)} = ${uph.toFixed(2)} UPH`);
  });
  
  // Show combined calculation (incorrect approach)
  console.log('\n\n❌ INCORRECT Combined Calculation (mixing work centers):');
  const totalDurationAllWC = Object.values(workCenterGroups).reduce((sum, wc) => sum + wc.totalDuration, 0);
  const totalHoursAllWC = totalDurationAllWC / 3600;
  const incorrectUPH = productionQty / totalHoursAllWC;
  console.log(`Total Duration (ALL work centers): ${totalDurationAllWC}s = ${totalHoursAllWC.toFixed(2)} hours`);
  console.log(`Incorrect UPH: ${productionQty} / ${totalHoursAllWC.toFixed(2)} = ${incorrectUPH.toFixed(2)} UPH`);
  
  console.log('\n✅ CORRECT Approach: Calculate UPH separately per work center!');

  process.exit(0);
}

checkPouchUPH();