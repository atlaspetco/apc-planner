import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { sql } from "drizzle-orm";

async function verifyEmpty() {
  try {
    // Check count
    const result = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    console.log(`Work cycles in database: ${result[0].count}`);
    
    // If not empty, clear completely
    if (result[0].count > 0) {
      console.log("Found remaining records, clearing completely...");
      await db.delete(workCycles);
      
      // Verify again
      const finalCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
      console.log(`Final count after clearing: ${finalCount[0].count}`);
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
  process.exit(0);
}

verifyEmpty();