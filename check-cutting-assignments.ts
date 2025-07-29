import { db } from './server/db.js';
import { uphData, operators, workCycles } from './shared/schema.js';
import { eq, sql, and } from 'drizzle-orm';

async function checkCuttingAssignments() {
  console.log('=== CUTTING ASSIGNMENT INVESTIGATION ===');
  
  // 1. Check all Cutting UPH data
  const cuttingUphData = await db.select().from(uphData).where(eq(uphData.workCenter, 'Cutting'));
  console.log(`\n1. Total Cutting UPH records: ${cuttingUphData.length}`);
  
  // Get unique operators with Cutting UPH data
  const operatorsWithCuttingUPH = new Set(cuttingUphData.map(d => d.operatorName));
  console.log(`   Operators with Cutting UPH data: ${Array.from(operatorsWithCuttingUPH).join(', ')}`);
  
  // 2. Check operators with Cutting enabled
  const allOperators = await db.select().from(operators);
  const cuttingEnabledOperators = allOperators.filter(op => op.workCenters?.includes('Cutting'));
  console.log(`\n2. Operators with Cutting enabled: ${cuttingEnabledOperators.map(op => op.name).join(', ')}`);
  
  // 3. Check recent work cycles for Cutting to see if there's newer data
  const recentCuttingCycles = await db
    .select({
      operatorName: workCycles.work_cycles_operator_rec_name,
      workCenter: workCycles.work_cycles_work_center_rec_name,
      duration: workCycles.work_cycles_duration,
      quantity: workCycles.work_cycles_quantity_done,
      moNumber: sql<string>`REGEXP_REPLACE(${workCycles.work_cycles_rec_name}, '.*MO([0-9]+).*', 'MO\\1')`,
      createDate: workCycles.work_production_create_date
    })
    .from(workCycles)
    .where(
      and(
        eq(workCycles.work_cycles_work_center_rec_name, 'Cutting'),
        sql`${workCycles.work_production_create_date} > NOW() - INTERVAL '7 days'`
      )
    )
    .limit(20);
    
  console.log(`\n3. Recent Cutting work cycles (last 7 days): ${recentCuttingCycles.length}`);
  if (recentCuttingCycles.length > 0) {
    const uniqueOperators = new Set(recentCuttingCycles.map(c => c.operatorName));
    console.log(`   Recent Cutting operators: ${Array.from(uniqueOperators).join(', ')}`);
  }
  
  // 4. Check if UPH calculation is missing some operators
  const operatorsWithoutUPH = cuttingEnabledOperators.filter(op => !operatorsWithCuttingUPH.has(op.name));
  console.log(`\n4. Operators with Cutting enabled but NO UPH data: ${operatorsWithoutUPH.map(op => op.name).join(', ')}`);
  
  // 5. Check work cycles for these operators to see if they have any Cutting data
  for (const op of operatorsWithoutUPH) {
    const cycles = await db
      .select()
      .from(workCycles)
      .where(
        and(
          eq(workCycles.work_cycles_operator_rec_name, op.name),
          eq(workCycles.work_cycles_work_center_rec_name, 'Cutting')
        )
      )
      .limit(5);
    
    if (cycles.length > 0) {
      console.log(`   ${op.name} has ${cycles.length} Cutting work cycles in database!`);
    }
  }
  
  process.exit(0);
}

checkCuttingAssignments();