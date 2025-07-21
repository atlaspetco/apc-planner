import { db } from './server/db.js';
import { workCycles } from './shared/schema.js';
import { eq, and, or, like, sql } from 'drizzle-orm';

async function checkCourtneyOperationData() {
  // Check if Courtney has work cycles with "Cutting - Fabric" in the operation field
  const courtneyOperations = await db.select({
    operator: workCycles.work_cycles_operator_rec_name,
    workCenter: workCycles.work_cycles_work_center_rec_name,
    operation: workCycles.work_operation_rec_name,
    routing: workCycles.work_production_routing_rec_name,
    count: sql<number>`COUNT(*)`,
  })
  .from(workCycles)
  .where(
    and(
      eq(workCycles.work_cycles_operator_rec_name, 'Courtney Banh'),
      eq(workCycles.work_cycles_work_center_rec_name, 'Cutting')
    )
  )
  .groupBy(
    workCycles.work_cycles_operator_rec_name,
    workCycles.work_cycles_work_center_rec_name,
    workCycles.work_operation_rec_name,
    workCycles.work_production_routing_rec_name
  );

  console.log('Courtney Banh work cycles for Cutting work center:');
  console.log('Total unique operation/routing combinations:', courtneyOperations.length);
  console.log('\nBreakdown:');
  courtneyOperations.forEach(record => {
    console.log(`- Operation: "${record.operation}", Routing: "${record.routing}", Count: ${record.count}`);
  });

  // Specifically check for "Cutting - Fabric" operation
  const cuttingFabricOps = courtneyOperations.filter(op => 
    op.operation?.includes('Cutting - Fabric') || 
    op.operation?.includes('Cutting-Fabric')
  );
  
  console.log('\n\nSpecifically for "Cutting - Fabric" operation:');
  console.log('Found', cuttingFabricOps.length, 'matching records');
  cuttingFabricOps.forEach(record => {
    console.log(`- Full operation name: "${record.operation}"`);
  });

  process.exit(0);
}

checkCourtneyOperationData().catch(console.error);