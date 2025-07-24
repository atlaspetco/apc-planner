import { db } from "./server/db.js";
import { workCycles, uphData } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function clearWorkCycles() {
  try {
    console.log("Clearing work_cycles table...");
    
    // Clear work_cycles table
    await db.delete(workCycles);
    console.log("✅ Cleared work_cycles table");
    
    // Also clear UPH data since it depends on work cycles
    await db.delete(uphData);
    console.log("✅ Cleared uphData table");
    
    // Verify the tables are empty
    const cycleCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    const uphCount = await db.select({ count: sql<number>`count(*)` }).from(uphData);
    
    console.log(`\nVerification:`);
    console.log(`Work cycles remaining: ${cycleCount[0].count}`);
    console.log(`UPH data remaining: ${uphCount[0].count}`);
    
  } catch (error) {
    console.error("Error clearing tables:", error);
  }
  process.exit(0);
}

clearWorkCycles();