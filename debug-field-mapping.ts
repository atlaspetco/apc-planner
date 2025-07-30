import { db } from "./server/db.js";
import { workCycles, workOrders, productionOrders } from "./shared/schema.js";
import { gt, isNotNull, eq, and, like } from "drizzle-orm";

async function debugFieldMapping() {
  console.log("=== DEBUGGING FIELD MAPPING ===");
  
  // 1. Check work cycles production order ID field
  console.log("\n1. WORK CYCLES - Production Order ID Field:");
  const sampleCycles = await db.select().from(workCycles).limit(5);
  sampleCycles.forEach((cycle, i) => {
    console.log(`${i+1}. Operator: ${cycle.work_cycles_operator_rec_name}, PO ID: ${cycle.work_production_id}, Duration: ${cycle.work_cycles_duration}s`);
  });
  
  // 2. Check assignments - what field contains production order ID?
  console.log("\n2. ASSIGNMENTS - Check all fields:");
  const sampleAssignments = await db
    .select()
    .from(workOrders)
    .limit(5);
  
  sampleAssignments.forEach((assignment, i) => {
    console.log(`${i+1}. Full assignment:`, assignment);
  });
  
  // 3. Check production orders table - what's the ID field?
  console.log("\n3. PRODUCTION ORDERS - Check ID field:");
  const samplePOs = await db.select().from(productionOrders).limit(5);
  samplePOs.forEach((po, i) => {
    console.log(`${i+1}. ID: ${po.id}, MO Number: ${po.moNumber}`);
  });
  
  // 4. Check if work cycles PO IDs match production orders IDs
  console.log("\n4. CHECKING FIELD ALIGNMENT:");
  const cyclePoIds = await db
    .select({ poId: workCycles.work_production_id })
    .from(workCycles)
    .where(like(workCycles.work_cycles_operator_rec_name, '%Courtney%'))
    .limit(10);
  
  const assignmentPoIds = await db
    .select()
    .from(workOrders)
    .limit(10);
  
  console.log("Work Cycles PO IDs:", cyclePoIds.map(c => c.poId));
  console.log("Assignment PO IDs:", assignmentPoIds);
  
  // 5. Check if there's overlap
  const cycleIds = new Set(cyclePoIds.map(c => c.poId));
  const assignmentIds = new Set(assignmentPoIds.map(a => a.poId));
  const overlap = [...cycleIds].filter(id => assignmentIds.has(id));
  console.log("Overlapping PO IDs:", overlap);
  
  process.exit(0);
}

debugFieldMapping().catch(console.error);