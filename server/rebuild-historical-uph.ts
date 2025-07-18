import { db } from "./db";
import { workCycles, historicalUph, operators, productionOrders } from "../shared/schema";
import { sql } from "drizzle-orm";

console.log("Starting to rebuild historical UPH table with correct calculations...");

async function rebuildHistoricalUph() {
  try {
    // Clear existing historicalUph table
    console.log("Clearing existing historicalUph table...");
    await db.delete(historicalUph);
    
    // Get all work cycles
    const allCycles = await db.select().from(workCycles);
    const allOperators = await db.select().from(operators);
    
    console.log(`Processing ${allCycles.length} work cycles...`);
    
    // Helper function to consolidate work centers
    const consolidateWorkCenter = (workCenter: string): string => {
      if (!workCenter) return 'Unknown';
      
      const wcLower = workCenter.toLowerCase();
      // Check for Sewing or Rope
      if (wcLower.includes('sewing') || wcLower.includes('rope')) {
        return 'Assembly';
      }
      // Check for common work centers
      if (wcLower.includes('cutting')) return 'Cutting';
      if (wcLower.includes('packaging')) return 'Packaging';
      if (wcLower.includes('assembly')) return 'Assembly';
      
      // Clean up compound names
      if (workCenter.includes(' / ')) {
        const parts = workCenter.split(' / ');
        return consolidateWorkCenter(parts[0].trim());
      }
      
      return workCenter;
    };
    
    // Group work cycles by MO for proper aggregation
    const moGroups = new Map<string, typeof allCycles>();
    
    allCycles.forEach(cycle => {
      if (!cycle.work_production_number) return;
      
      const moNumber = cycle.work_production_number;
      if (!moGroups.has(moNumber)) {
        moGroups.set(moNumber, []);
      }
      moGroups.get(moNumber)!.push(cycle);
    });
    
    console.log(`Found ${moGroups.size} unique MOs to process`);
    
    // Calculate UPH for each MO first
    const moUphCalculations = new Map<string, {
      operatorName: string,
      routing: string,
      workCenter: string,
      uph: number,
      totalQuantity: number,
      totalHours: number
    }>();
    
    moGroups.forEach((cycles, moNumber) => {
      // Group by operator + work center within this MO
      const operatorWcGroups = new Map<string, typeof cycles>();
      
      cycles.forEach(cycle => {
        if (!cycle.work_cycles_operator_rec_name || !cycle.work_cycles_work_center_rec_name) return;
        
        const key = `${cycle.work_cycles_operator_rec_name}|${consolidateWorkCenter(cycle.work_cycles_work_center_rec_name)}`;
        if (!operatorWcGroups.has(key)) {
          operatorWcGroups.set(key, []);
        }
        operatorWcGroups.get(key)!.push(cycle);
      });
      
      // First, find the MO quantity (should be the same across all cycles for this MO)
      // Use the maximum quantity_done value as the MO quantity
      let moQuantity = 0;
      cycles.forEach(cycle => {
        if (cycle.work_cycles_quantity_done) {
          moQuantity = Math.max(moQuantity, cycle.work_cycles_quantity_done);
        }
      });
      
      // Calculate UPH for each operator/work center combination in this MO
      operatorWcGroups.forEach((wcCycles, key) => {
        const [operatorName, workCenter] = key.split('|');
        
        // Sum only durations (NOT quantities)
        let totalDurationSeconds = 0;
        let routing = '';
        
        wcCycles.forEach(cycle => {
          if (cycle.work_cycles_duration > 0) {
            totalDurationSeconds += cycle.work_cycles_duration;
            routing = cycle.work_production_routing_rec_name || routing;
          }
        });
        
        if (totalDurationSeconds > 0 && moQuantity > 0 && routing) {
          const totalHours = totalDurationSeconds / 3600;
          const uph = moQuantity / totalHours;
          
          // Store this MO's UPH calculation
          const moKey = `${moNumber}|${operatorName}|${workCenter}|${routing}`;
          moUphCalculations.set(moKey, {
            operatorName,
            routing,
            workCenter,
            uph,
            totalQuantity: moQuantity,
            totalHours
          });
        }
      });
    });
    
    console.log(`Calculated UPH for ${moUphCalculations.size} MO/operator/work center combinations`);
    
    // Now average UPH across MOs for each operator/routing/work center combination
    const finalUphData = new Map<string, {
      operatorId: number,
      operatorName: string,
      routing: string,
      workCenter: string,
      uphValues: number[],
      totalObservations: number
    }>();
    
    moUphCalculations.forEach((calc, moKey) => {
      const key = `${calc.operatorName}|${calc.routing}|${calc.workCenter}`;
      
      if (!finalUphData.has(key)) {
        // Find operator ID
        const operator = allOperators.find(op => op.name === calc.operatorName);
        if (!operator) return;
        
        finalUphData.set(key, {
          operatorId: operator.id,
          operatorName: calc.operatorName,
          routing: calc.routing,
          workCenter: calc.workCenter,
          uphValues: [],
          totalObservations: 0
        });
      }
      
      const data = finalUphData.get(key)!;
      data.uphValues.push(calc.uph);
      data.totalObservations += 1; // Each MO counts as 1 observation
    });
    
    // Insert averaged UPH values into historicalUph table
    const insertPromises: Promise<any>[] = [];
    let insertCount = 0;
    
    finalUphData.forEach(data => {
      // Calculate average UPH
      const avgUph = data.uphValues.reduce((sum, uph) => sum + uph, 0) / data.uphValues.length;
      
      // Skip unrealistic values
      if (avgUph > 1000 || avgUph < 0.1) {
        console.log(`Skipping unrealistic UPH: ${data.operatorName} | ${data.workCenter} | ${data.routing}: ${avgUph.toFixed(2)} UPH`);
        return;
      }
      
      // Calculate total quantity and total hours across all MOs
      let totalQuantity = 0;
      let totalHours = 0;
      
      // Get the actual totals from the MO calculations
      moUphCalculations.forEach((calc, moKey) => {
        if (moKey.includes(`|${data.operatorName}|${data.workCenter}|${data.routing}`)) {
          totalQuantity += calc.totalQuantity;
          totalHours += calc.totalHours;
        }
      });
      
      insertPromises.push(
        db.insert(historicalUph).values({
          operatorId: data.operatorId,
          operator: data.operatorName,
          workCenter: data.workCenter,
          routing: data.routing,
          operation: data.workCenter, // Using work center as operation since we don't have operation data
          totalQuantity: Math.round(totalQuantity),
          totalHours: Math.round(totalHours * 100) / 100,
          unitsPerHour: Math.round(avgUph * 100) / 100,
          observations: data.totalObservations,
          dataSource: 'work-cycles-rebuild-2025-07-18'
        })
      );
      
      insertCount++;
      console.log(`${data.operatorName} | ${data.workCenter} | ${data.routing}: ${avgUph.toFixed(2)} UPH (avg from ${data.uphValues.length} MOs)`);
    });
    
    await Promise.all(insertPromises);
    
    console.log(`\nRebuild complete! Inserted ${insertCount} UPH records into historicalUph table.`);
    
    // Verify the problematic entry was fixed
    const verifyResult = await db.select()
      .from(historicalUph)
      .where(sql`operator = 'Courtney Banh' AND routing = 'Lifetime Pouch' AND work_center = 'Assembly'`);
    
    if (verifyResult.length > 0) {
      console.log(`\nVerification: Courtney Banh | Assembly | Lifetime Pouch now shows ${verifyResult[0].unitsPerHour} UPH (was 207.64)`);
    }
    
  } catch (error) {
    console.error("Error rebuilding historicalUph table:", error);
  }
}

rebuildHistoricalUph().then(() => {
  process.exit(0);
});