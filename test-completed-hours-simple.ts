import { db } from "./server/db.js";
import { workCycles } from "./shared/schema.js";
import { and, eq, gt, isNotNull } from "drizzle-orm";

async function testCompletedHours() {
  console.log("🔍 Testing completed hours calculation based on user insight:");
  console.log("Completed work cycles = those in 'done' state that can't be assigned anymore\n");

  try {
    // Get all work cycles in 'done' state - these are completed and can't be assigned anymore
    const completedCycles = await db
      .select({
        operatorName: workCycles.work_cycles_operator_rec_name,
        duration: workCycles.work_cycles_duration,
        state: workCycles.state
      })
      .from(workCycles)
      .where(
        and(
          eq(workCycles.state, 'done'),
          gt(workCycles.work_cycles_duration, 0),
          isNotNull(workCycles.work_cycles_duration),
          isNotNull(workCycles.work_cycles_operator_rec_name)
        )
      );

    console.log(`📊 Found ${completedCycles.length} completed work cycles in 'done' state`);

    // Calculate total completed hours per operator
    const totalCompletedHoursByOperator = new Map<string, number>();
    
    completedCycles.forEach(cycle => {
      if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
        const hours = cycle.duration / 3600; // Convert seconds to hours
        const currentHours = totalCompletedHoursByOperator.get(cycle.operatorName) || 0;
        totalCompletedHoursByOperator.set(cycle.operatorName, currentHours + hours);
      }
    });

    console.log(`\n✅ Total completed hours per operator:`);
    Array.from(totalCompletedHoursByOperator.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by hours descending
      .forEach(([operatorName, hours]) => {
        console.log(`  ${operatorName}: ${hours.toFixed(2)}h completed`);
      });

    console.log(`\n🎯 This simple approach shows total completed hours per operator`);
    console.log(`🎯 These hours represent work that's done and can't be assigned anymore`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testCompletedHours();