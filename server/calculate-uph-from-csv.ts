import fs from 'fs';
import { db } from './db.js';
import { uphData } from '../shared/schema.js';

/**
 * CALCULATE UPH DIRECTLY FROM CSV DATA
 * Skip database import and calculate UPH directly from CSV file
 */

interface WorkCycle {
  duration: string;
  operator: string;
  workCenter: string;
  routing: string;
  operation: string;
  moNumber: string;
  quantity: number;
}

function parseHHMMSSDuration(durationStr: string): number {
  if (!durationStr) return 0;
  
  const parts = durationStr.split(':').map(p => parseInt(p, 10));
  
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  } else if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  
  return 0;
}

function consolidateWorkCenter(workCenter: string): string {
  if (workCenter.includes('Assembly') || workCenter.includes('Sewing') || workCenter.includes('Rope')) {
    return 'Assembly';
  } else if (workCenter.includes('Cutting')) {
    return 'Cutting';
  } else if (workCenter.includes('Packaging')) {
    return 'Packaging';
  }
  return workCenter;
}

async function calculateUphFromCsv(): Promise<void> {
  console.log("🚀 CALCULATING UPH DIRECTLY FROM CSV DATA");
  
  const csvPath = './attached_assets/Work Cycles - cycles w_id_1751614823980.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n');
  
  if (lines.length < 2) {
    console.log("❌ CSV file is empty or invalid");
    return;
  }
  
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  console.log(`📊 Processing ${lines.length - 1} CSV records directly`);
  
  // Parse CSV into work cycles
  const workCycles: WorkCycle[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',').map(v => v.replace(/"/g, '').trim());
    
    const duration = values[0] || '';
    const operator = values[2] || '';
    const workCenter = values[4] || '';
    const quantity = parseInt(values[5]) || 0;
    const moNumber = values[6] || '';
    const routing = values[8] || '';
    const operation = values[10] || '';
    
    if (duration && operator && workCenter && routing && quantity > 0) {
      workCycles.push({
        duration,
        operator,
        workCenter,
        routing,
        operation,
        moNumber,
        quantity
      });
    }
  }
  
  console.log(`✅ Parsed ${workCycles.length} valid work cycles from CSV`);
  
  // Focus on Dani's data
  const daniCycles = workCycles.filter(cycle => cycle.operator === 'Dani Mayta');
  console.log(`🎯 Found ${daniCycles.length} work cycles for Dani Mayta`);
  
  if (daniCycles.length > 0) {
    // Group by operator + consolidated work center + routing + MO
    const groupedData = new Map<string, {
      operator: string;
      workCenter: string;
      routing: string;
      moNumber: string;
      totalDurationSeconds: number;
      totalQuantity: number;
      cycleCount: number;
      operations: Set<string>;
    }>();
    
    for (const cycle of daniCycles) {
      const consolidatedWorkCenter = consolidateWorkCenter(cycle.workCenter);
      const key = `${cycle.operator}|${consolidatedWorkCenter}|${cycle.routing}|${cycle.moNumber}`;
      
      if (!groupedData.has(key)) {
        groupedData.set(key, {
          operator: cycle.operator,
          workCenter: consolidatedWorkCenter,
          routing: cycle.routing,
          moNumber: cycle.moNumber,
          totalDurationSeconds: 0,
          totalQuantity: cycle.quantity, // Use MO quantity once
          cycleCount: 0,
          operations: new Set()
        });
      }
      
      const group = groupedData.get(key)!;
      group.totalDurationSeconds += parseHHMMSSDuration(cycle.duration);
      group.cycleCount += 1;
      group.operations.add(cycle.operation);
    }
    
    console.log(`📋 Grouped into ${groupedData.size} MO-level calculations for Dani`);
    
    // Calculate UPH for each group
    const uphCalculations = [];
    
    for (const [key, group] of groupedData) {
      if (group.totalDurationSeconds > 60) { // Minimum 1 minute
        const durationHours = group.totalDurationSeconds / 3600;
        const uph = group.totalQuantity / durationHours;
        
        if (uph > 0.5 && uph < 1000) {
          const combinedOperations = Array.from(group.operations).join(' + ');
          
          uphCalculations.push({
            operatorId: 40, // Dani's ID
            operatorName: group.operator,
            workCenter: group.workCenter,
            routing: group.routing,
            productRouting: group.routing, // Fix: populate both fields with same value
            operation: combinedOperations,
            uph: Math.round(uph * 100) / 100,
            observationCount: group.cycleCount,
            totalDurationHours: Math.round(durationHours * 100) / 100,
            totalQuantity: group.totalQuantity,
            dataSource: 'csv_direct_calculation',
            lastUpdated: new Date().toISOString()
          });
          
          console.log(`  ${group.operator} | ${group.workCenter} | ${group.routing}`);
          console.log(`    MO: ${group.moNumber}, Qty: ${group.totalQuantity}, Duration: ${durationHours.toFixed(2)}h, UPH: ${uph.toFixed(2)}`);
        }
      }
    }
    
    console.log(`💾 Inserting ${uphCalculations.length} UPH calculations for Dani`);
    
    // Insert into database
    if (uphCalculations.length > 0) {
      await db.insert(uphData).values(uphCalculations);
      console.log(`✅ Successfully inserted Dani's UPH data into database`);
    }
  }
}

// Run the calculation
calculateUphFromCsv().catch(console.error);