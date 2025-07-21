import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { eq, and, sql, like } from 'drizzle-orm';

async function checkPouchUPH() {
  // First find all Lifetime Pouch MOs
  const pouchMOs = await db.select().from(productionOrders)
    .where(eq(productionOrders.routing, 'Lifetime Pouch'))
    .limit(10);
    
  console.log('Found', pouchMOs.length, 'Lifetime Pouch MOs:', pouchMOs.map(mo => mo.moNumber));
  
  // Check work cycles for Courtney Banh on Lifetime Pouch
  const cycles = await db.select({
    moNumber: workCycles.work_production_number,
    operation: workCycles.work_operation_rec_name,
    workCenter: workCycles.work_cycles_work_center_rec_name,
    duration: workCycles.work_cycles_duration,
    quantity: workCycles.work_production_quantity,
    routing: workCycles.work_production_routing_rec_name
  }).from(workCycles)
    .where(and(
      eq(workCycles.work_cycles_operator_rec_name, 'Courtney Banh'),
      like(workCycles.work_production_routing_rec_name, '%Pouch%')
    ))
    .limit(20);

  console.log('\nCourtney Banh work cycles on Pouch routing:');
  
  // Group by MO
  const moGroups = cycles.reduce((acc, cycle) => {
    if (!acc[cycle.moNumber || '']) {
      acc[cycle.moNumber || ''] = [];
    }
    acc[cycle.moNumber || ''].push(cycle);
    return acc;
  }, {} as Record<string, typeof cycles>);
  
  Object.entries(moGroups).forEach(([moNumber, moCycles]) => {
    console.log(`\nMO: ${moNumber}`);
    console.log('Routing:', moCycles[0]?.routing);
    
    // Find production order quantity
    const mo = pouchMOs.find(m => m.moNumber === moNumber);
    const prodQty = mo?.quantity || moCycles[0]?.quantity || 0;
    console.log('Production Order Quantity:', prodQty);
    
    let totalDuration = 0;
    moCycles.forEach(c => {
      console.log(`  - ${c.operation} | ${c.workCenter} | ${c.duration}s`);
      totalDuration += c.duration || 0;
    });
    
    const hours = totalDuration / 3600;
    const uph = prodQty / hours;
    console.log(`Total Duration: ${totalDuration}s = ${hours.toFixed(2)}h`);
    console.log(`UPH: ${prodQty} / ${hours.toFixed(2)} = ${uph.toFixed(2)}`);
  });

  process.exit(0);
}

checkPouchUPH();