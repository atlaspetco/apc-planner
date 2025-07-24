import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { eq, gt, and } from "drizzle-orm";

// Fulfil API configuration
const FULFIL_API_URL = "https://apc.fulfil.io/api/v2";
const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;

if (!FULFIL_ACCESS_TOKEN) {
  console.error("❌ FULFIL_ACCESS_TOKEN not found in environment");
  process.exit(1);
}

interface FulfilWorkCycle {
  id: number;
  work: {
    id: number;
    production: {
      number: string;
    };
  };
  operator: {
    rec_name: string;
  };
  work_center: {
    rec_name: string;
  };
  duration: number; // In seconds
  quantity_done: number;
  state: string;
}

async function fetchWorkCyclesFromFulfil(workId: number): Promise<FulfilWorkCycle[]> {
  try {
    const response = await fetch(`${FULFIL_API_URL}/model/production.work.cycle`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": FULFIL_ACCESS_TOKEN!,
      },
      body: JSON.stringify({
        method: "search_read",
        params: [
          [["work", "=", workId]], // Filter by work ID
          [
            "id",
            "work.id",
            "work.production.number",
            "operator.rec_name",
            "work_center.rec_name",
            "duration",
            "quantity_done",
            "state"
          ],
        ],
      }),
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch cycles for work ${workId}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.result || [];
  } catch (error) {
    console.error(`❌ Error fetching cycles for work ${workId}:`, error);
    return [];
  }
}

async function fixWorkCycleDurations() {
  console.log("🔍 Finding work cycles with suspicious durations (>8 hours)...");
  
  // Get all work cycles with durations over 8 hours
  const suspiciousCycles = await db
    .select()
    .from(workCycles)
    .where(
      and(
        gt(workCycles.duration_sec, 28800), // More than 8 hours
        eq(workCycles.data_corrupted, false)
      )
    )
    .limit(10); // Start with just 10 to test
  
  console.log(`Found ${suspiciousCycles.length} suspicious cycles to check`);
  
  // Group by work ID to minimize API calls
  const workIdMap = new Map<number, typeof suspiciousCycles>();
  
  for (const cycle of suspiciousCycles) {
    if (!cycle.work_cycles_id) continue;
    
    const workId = parseInt(cycle.work_cycles_id.toString());
    if (!workIdMap.has(workId)) {
      workIdMap.set(workId, []);
    }
    workIdMap.get(workId)!.push(cycle);
  }
  
  console.log(`\n📊 Checking ${workIdMap.size} unique work orders...`);
  
  let fixedCount = 0;
  
  for (const [workId, localCycles] of workIdMap) {
    console.log(`\n🔄 Fetching work cycles for work ID ${workId}...`);
    
    const fulfilCycles = await fetchWorkCyclesFromFulfil(workId);
    
    if (fulfilCycles.length === 0) {
      console.log(`⚠️  No cycles found in Fulfil for work ${workId}`);
      continue;
    }
    
    // Calculate total duration from Fulfil
    const fulfilTotalDuration = fulfilCycles.reduce((sum, cycle) => sum + cycle.duration, 0);
    
    // Get our total duration
    const localTotalDuration = localCycles.reduce((sum, cycle) => sum + (cycle.duration_sec || 0), 0);
    
    console.log(`📊 Work ${workId} (${localCycles[0].work_production_number}):`);
    console.log(`   Local duration: ${(localTotalDuration / 3600).toFixed(2)} hours`);
    console.log(`   Fulfil duration: ${(fulfilTotalDuration / 3600).toFixed(2)} hours`);
    console.log(`   Difference: ${((localTotalDuration - fulfilTotalDuration) / 3600).toFixed(2)} hours`);
    
    // If there's a significant difference, update our data
    if (Math.abs(localTotalDuration - fulfilTotalDuration) > 300) { // More than 5 minutes difference
      console.log(`   ✅ Updating duration from ${localTotalDuration}s to ${fulfilTotalDuration}s`);
      
      // For now, we'll update the single consolidated cycle
      // In a real scenario, we might want to recreate individual cycles
      for (const localCycle of localCycles) {
        await db
          .update(workCycles)
          .set({
            duration_sec: fulfilTotalDuration, // Use total from Fulfil
            updated_at: new Date()
          })
          .where(eq(workCycles.id, localCycle.id));
        
        fixedCount++;
      }
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n✅ Fixed ${fixedCount} work cycle durations`);
  console.log("🔄 Run the UPH recalculation to update the UPH values with corrected durations");
}

// Run the fix
fixWorkCycleDurations()
  .then(() => {
    console.log("✅ Duration fix complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error fixing durations:", error);
    process.exit(1);
  });