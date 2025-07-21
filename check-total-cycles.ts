import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { count } from "drizzle-orm";

async function checkTotalCycles() {
  try {
    // Count total work cycles
    const [totalResult] = await db.select({ count: count() }).from(workCycles);
    console.log(`Total work cycles in database: ${totalResult.count}`);
    
    // Get date range
    const cycles = await db.select({
      minDate: workCycles.work_production_create_date,
      maxDate: workCycles.work_production_create_date
    })
    .from(workCycles)
    .orderBy(workCycles.work_production_create_date)
    .limit(1);
    
    const latestCycles = await db.select({
      maxDate: workCycles.work_production_create_date
    })
    .from(workCycles)
    .orderBy(workCycles.work_production_create_date)
    .limit(1);
    
    console.log(`Date range: ${cycles[0]?.minDate} to ${latestCycles[0]?.maxDate}`);
    
    // Count cycles by date range
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
    
    const recentCycles = await db.select({ count: count() })
      .from(workCycles)
      .where(sql`${workCycles.work_production_create_date} >= ${thirtyDaysAgo}`);
      
    const threeMonthCycles = await db.select({ count: count() })
      .from(workCycles)
      .where(sql`${workCycles.work_production_create_date} >= ${ninetyDaysAgo}`);
    
    console.log(`Cycles in last 30 days: ${recentCycles[0].count}`);
    console.log(`Cycles in last 90 days: ${threeMonthCycles[0].count}`);
    
  } catch (error) {
    console.error("Error checking cycles:", error);
  }
  process.exit(0);
}

checkTotalCycles();
