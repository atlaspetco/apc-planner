import { db } from './server/db.js';
import { operators, workOrderAssignments } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';

async function checkEvanIds() {
  // Check Evan's operator ID
  const evan = await db.select().from(operators).where(eq(operators.name, 'Evan Crosby')).limit(1);
  console.log('Evan Crosby operator record:', evan);

  // Check assignments with Evan
  if (evan.length > 0) {
    const evanAssignments = await db.select().from(workOrderAssignments).where(eq(workOrderAssignments.operatorId, evan[0].id)).limit(5);
    console.log('\nEvan assignments by operator ID (first 5):');
    evanAssignments.forEach(a => {
      console.log(`  WO: ${a.workOrderId}, operatorId: ${a.operatorId}`);
    });
  }

  // Check all operator IDs
  const allOps = await db.select({ id: operators.id, name: operators.name }).from(operators);
  console.log('\nAll operators:');
  allOps.forEach(op => {
    console.log(`  ID: ${op.id}, Name: ${op.name}`);
  });
  
  // Check assignment join with activeWorkOrders
  console.log('\nChecking assignments data structure...');
  const query = sql`
    SELECT 
      a.operator_id,
      o.name as operator_name,
      a.work_order_id,
      COUNT(*) as count
    FROM work_order_assignments a
    JOIN operators o ON o.id = a.operator_id
    WHERE o.name = 'Evan Crosby'
    GROUP BY a.operator_id, o.name, a.work_order_id
    LIMIT 5
  `;
  const assignmentsWithNames = await db.execute(query);
  console.log('Evan assignments with names:', assignmentsWithNames);
  
  process.exit(0);
}

checkEvanIds();