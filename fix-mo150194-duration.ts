import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { eq } from "drizzle-orm";

// Fulfil API configuration
const FULFIL_API_URL = "https://apc.fulfil.io/api/v2";
const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;

if (!FULFIL_ACCESS_TOKEN) {
  console.error("❌ FULFIL_ACCESS_TOKEN not found in environment");
  process.exit(1);
}

async function fixMO150194() {
  console.log("🔍 Fetching correct data for MO150194 from Fulfil API...");
  
  // Fetch work orders for MO150194
  const response = await fetch(`${FULFIL_API_URL}/model/production.work`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": FULFIL_ACCESS_TOKEN!,
    },
    body: JSON.stringify({
      method: "search_read",
      params: [
        [["production.number", "=", "MO150194"]], // Filter by MO number
        [
          "id",
          "rec_name",
          "production.number",
          "employee.rec_name",
          "work_center.rec_name",
          "operation.rec_name",
          "state"
        ],
      ],
    }),
  });

  if (!response.ok) {
    console.error(`❌ Failed to fetch work orders: ${response.status}`);
    return;
  }

  const workOrders = await response.json();
  console.log(`Found ${workOrders.result.length} work orders for MO150194`);
  
  // Find the sewing work order
  const sewingWorkOrder = workOrders.result.find(wo => 
    wo["operation.rec_name"]?.toLowerCase().includes("sewing")
  );
  
  if (!sewingWorkOrder) {
    console.error("❌ Could not find sewing work order");
    return;
  }
  
  console.log(`\n📋 Found Sewing work order: ${sewingWorkOrder.rec_name} (ID: ${sewingWorkOrder.id})`);
  
  // Now fetch the work cycles for this work order
  const cyclesResponse = await fetch(`${FULFIL_API_URL}/model/production.work.cycle`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": FULFIL_ACCESS_TOKEN!,
    },
    body: JSON.stringify({
      method: "search_read",
      params: [
        [["work", "=", sewingWorkOrder.id]], // Filter by work ID
        [
          "id",
          "operator.rec_name",
          "duration",
          "quantity_done",
          "state"
        ],
      ],
    }),
  });

  if (!cyclesResponse.ok) {
    console.error(`❌ Failed to fetch work cycles: ${cyclesResponse.status}`);
    return;
  }

  const cycles = await cyclesResponse.json();
  console.log(`\n📊 Found ${cycles.result.length} work cycles for sewing operation:`);
  
  let totalDuration = 0;
  let totalQuantity = 0;
  
  cycles.result.forEach((cycle, index) => {
    const durationMinutes = cycle.duration / 60;
    console.log(`   Cycle ${index + 1}: ${durationMinutes.toFixed(2)} minutes (${cycle.duration}s), Quantity: ${cycle.quantity_done}`);
    totalDuration += cycle.duration;
    totalQuantity += cycle.quantity_done;
  });
  
  console.log(`\n📈 Totals from Fulfil:`);
  console.log(`   Total duration: ${(totalDuration / 60).toFixed(2)} minutes (${totalDuration} seconds)`);
  console.log(`   Total duration: ${(totalDuration / 3600).toFixed(2)} hours`);
  console.log(`   Total quantity: ${totalQuantity}`);
  
  // Get our current data
  const currentData = await db
    .select()
    .from(workCycles)
    .where(eq(workCycles.work_cycles_id, "692509"));
  
  if (currentData.length === 0) {
    console.error("❌ Could not find work cycle 692509 in database");
    return;
  }
  
  const current = currentData[0];
  console.log(`\n📊 Current database values:`);
  console.log(`   Duration: ${(current.duration_sec! / 3600).toFixed(2)} hours (${current.duration_sec} seconds)`);
  console.log(`   Quantity: ${current.work_cycles_quantity_done}`);
  
  console.log(`\n🔄 Updating work cycle 692509 with correct values...`);
  
  // Update the work cycle with correct duration
  await db
    .update(workCycles)
    .set({
      duration_sec: totalDuration,
      work_cycles_quantity_done: totalQuantity,
      updated_at: new Date()
    })
    .where(eq(workCycles.work_cycles_id, "692509"));
  
  console.log(`✅ Updated work cycle 692509:`);
  console.log(`   Duration: ${current.duration_sec}s → ${totalDuration}s`);
  console.log(`   Quantity: ${current.work_cycles_quantity_done} → ${totalQuantity}`);
  
  // Also need to update the consolidated table
  console.log(`\n🔄 Updating consolidated data...`);
  
  // Run the consolidation script to update operator_uph table
  console.log("💡 Run consolidate-operator-uph.ts to recalculate UPH with corrected durations");
}

// Run the fix
fixMO150194()
  .then(() => {
    console.log("\n✅ Fix complete for MO150194");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });