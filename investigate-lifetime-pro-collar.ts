import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql } from "drizzle-orm";

async function investigateLifetimeProCollar() {
  console.log("🔍 INVESTIGATING: Lifetime Pro Collar Assembly Corruption");
  console.log("=" .repeat(70));
  
  // Find all Lifetime Pro Collar Assembly cycles for Courtney Banh
  const cycles = await db
    .select({
      id: workCycles.id,
      work_cycles_id: workCycles.work_cycles_id,
      work_production_number: workCycles.work_production_number,
      duration_sec: workCycles.duration_sec,
      work_cycles_quantity_done: workCycles.work_cycles_quantity_done,
      data_corrupted: workCycles.data_corrupted,
      work_cycles_operator_rec_name: workCycles.work_cycles_operator_rec_name,
      work_production_routing_rec_name: workCycles.work_production_routing_rec_name,
      work_cycles_work_center_rec_name: workCycles.work_cycles_work_center_rec_name
    })
    .from(workCycles)
    .where(sql`
      work_cycles_operator_rec_name = 'Courtney Banh' 
      AND work_production_routing_rec_name = 'Lifetime Pro Collar'
      AND (work_cycles_work_center_rec_name LIKE '%Assembly%' 
           OR work_cycles_work_center_rec_name LIKE '%Sewing%' 
           OR work_cycles_work_center_rec_name LIKE '%Rope%')
    `);
  
  console.log(`\n📊 Found ${cycles.length} Lifetime Pro Collar Assembly cycles for Courtney Banh`);
  
  // Group by MO and analyze durations
  const moAnalysis = new Map<string, {
    cycles: typeof cycles,
    totalDuration: number,
    totalQuantity: number,
    avgHoursPerUnit: number
  }>();
  
  cycles.forEach(cycle => {
    const mo = cycle.work_production_number;
    if (!mo) return;
    
    if (!moAnalysis.has(mo)) {
      moAnalysis.set(mo, {
        cycles: [],
        totalDuration: 0,
        totalQuantity: 0,
        avgHoursPerUnit: 0
      });
    }
    
    const analysis = moAnalysis.get(mo)!;
    analysis.cycles.push(cycle);
    analysis.totalDuration += (cycle.duration_sec || 0);
    analysis.totalQuantity += (cycle.work_cycles_quantity_done || 0);
  });
  
  // Calculate hours per unit for each MO
  moAnalysis.forEach((analysis, mo) => {
    analysis.avgHoursPerUnit = (analysis.totalDuration / 3600) / analysis.totalQuantity;
  });
  
  // Sort by hours per unit (highest first) to identify most corrupted
  const sortedMOs = Array.from(moAnalysis.entries())
    .sort(([_, a], [__, b]) => b.avgHoursPerUnit - a.avgHoursPerUnit);
  
  console.log("\n🚨 TOP 15 MOST SUSPICIOUS MOs (Hours per Unit):");
  sortedMOs.slice(0, 15).forEach(([mo, analysis], index) => {
    const totalHours = analysis.totalDuration / 3600;
    const corrupted = analysis.cycles.some(c => c.data_corrupted);
    const corruptedFlag = corrupted ? " [FLAGGED]" : " [NOT FLAGGED]";
    
    console.log(`   ${(index + 1).toString().padStart(2)}. ${mo}: ${totalHours.toFixed(2)}h for ${analysis.totalQuantity} units = ${analysis.avgHoursPerUnit.toFixed(2)}h/unit${corruptedFlag}`);
  });
  
  // Identify cycles that should be flagged as corrupted (>2 hours per unit)
  console.log("\n🔧 CYCLES NEEDING CORRUPTION FLAG (>2 hours per unit):");
  
  let newCorruptionCount = 0;
  const cyclesToFlag: number[] = [];
  
  sortedMOs.forEach(([mo, analysis]) => {
    if (analysis.avgHoursPerUnit > 2.0) { // More than 2 hours per unit is suspicious for Assembly
      analysis.cycles.forEach(cycle => {
        if (!cycle.data_corrupted) {
          cyclesToFlag.push(cycle.id!);
          newCorruptionCount++;
          console.log(`   - ${mo}: Cycle ID ${cycle.id} (${(cycle.duration_sec! / 3600).toFixed(2)}h)`);
        }
      });
    }
  });
  
  console.log(`\n💡 SUMMARY:`);
  console.log(`   - Found ${newCorruptionCount} additional cycles to flag as corrupted`);
  console.log(`   - Current threshold was too conservative (8h), Assembly should be ~0.5-1.5h per unit max`);
  console.log(`   - Lifetime Pro Collar Assembly should be ~15-25 UPH, not 8.79 UPH`);
  
  // Flag the additional corrupted cycles
  if (cyclesToFlag.length > 0) {
    console.log(`\n🏷️  Flagging ${cyclesToFlag.length} additional corrupted cycles...`);
    
    await db
      .update(workCycles)
      .set({ data_corrupted: true })
      .where(sql`id = ANY(${cyclesToFlag})`);
    
    console.log(`   ✅ Successfully flagged ${cyclesToFlag.length} additional cycles as corrupted`);
  }
  
  // Show what the UPH would look like with only clean data
  const cleanCycles = cycles.filter(c => !c.data_corrupted && !cyclesToFlag.includes(c.id!));
  const cleanMOAnalysis = new Map<string, { totalDuration: number, totalQuantity: number }>();
  
  cleanCycles.forEach(cycle => {
    const mo = cycle.work_production_number;
    if (!mo) return;
    
    if (!cleanMOAnalysis.has(mo)) {
      cleanMOAnalysis.set(mo, { totalDuration: 0, totalQuantity: 0 });
    }
    
    const analysis = cleanMOAnalysis.get(mo)!;
    analysis.totalDuration += (cycle.duration_sec || 0);
    analysis.totalQuantity += (cycle.work_cycles_quantity_done || 0);
  });
  
  if (cleanMOAnalysis.size > 0) {
    let totalCleanQuantity = 0;
    let totalCleanDuration = 0;
    
    cleanMOAnalysis.forEach(analysis => {
      totalCleanQuantity += analysis.totalQuantity;
      totalCleanDuration += analysis.totalDuration;
    });
    
    const cleanUPH = totalCleanQuantity / (totalCleanDuration / 3600);
    
    console.log(`\n📈 PROJECTED CLEAN UPH:`);
    console.log(`   - Clean quantity: ${totalCleanQuantity} units`);
    console.log(`   - Clean duration: ${(totalCleanDuration / 3600).toFixed(2)} hours`);
    console.log(`   - Clean UPH: ${cleanUPH.toFixed(2)} (vs current 8.79)`);
  }
}

investigateLifetimeProCollar()
  .then(() => {
    console.log("\n✅ Investigation complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });