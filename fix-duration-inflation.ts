#!/usr/bin/env npx tsx

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { workCycles } from './shared/schema.ts';
import { eq, and, gt } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function fixDurationInflation() {
  console.log('🔍 Investigating duration inflation issue...');
  
  // Find cycles with suspicious durations (over 8 hours = 28,800 seconds)
  const suspiciousCycles = await db.select().from(workCycles)
    .where(gt(workCycles.duration_sec, 28800));
  
  console.log(`📊 Found ${suspiciousCycles.length} cycles with duration > 8 hours`);
  
  if (suspiciousCycles.length > 0) {
    console.log('🔍 Sample suspicious cycles:');
    suspiciousCycles.slice(0, 5).forEach(cycle => {
      const hours = (cycle.duration_sec || 0) / 3600;
      console.log(`  • ${cycle.work_production_number} - ${cycle.work_cycles_operator_rec_name}: ${hours.toFixed(2)} hours`);
    });
  }
  
  // For Work Order level consolidation, we should expect each WO to have ONE record
  // Let's check if we have multiple cycles per WO that are being summed incorrectly
  const duplicateWOs = await db.select({
    woNumber: workCycles.work_cycles_rec_name,
    count: workCycles.work_cycles_id
  }).from(workCycles);
  
  // Group by WO number to find duplicates
  const woGroups = new Map<string, number>();
  for (const cycle of duplicateWOs) {
    const wo = cycle.woNumber;
    if (wo) {
      woGroups.set(wo, (woGroups.get(wo) || 0) + 1);
    }
  }
  
  const duplicatedWOs = Array.from(woGroups.entries()).filter(([_, count]) => count > 1);
  
  console.log(`📊 Found ${duplicatedWOs.length} Work Orders with multiple cycles`);
  if (duplicatedWOs.length > 0) {
    console.log('🔍 Sample duplicated WOs:');
    duplicatedWOs.slice(0, 5).forEach(([wo, count]) => {
      console.log(`  • ${wo}: ${count} cycles`);
    });
  }
  
  // Check the specific MOs the user mentioned
  const problematicMOs = await db.select().from(workCycles)
    .where(and(
      eq(workCycles.work_cycles_operator_rec_name, 'Dani Mayta'),
      eq(workCycles.work_production_routing_rec_name, 'Lifetime Harness')
    ));
  
  console.log(`📊 Dani Mayta + Lifetime Harness: ${problematicMOs.length} total cycles`);
  
  const avgDuration = problematicMOs.reduce((sum, cycle) => sum + (cycle.duration_sec || 0), 0) / problematicMOs.length;
  console.log(`📊 Average duration: ${(avgDuration / 3600).toFixed(2)} hours`);
  
  // Check for realistic durations (Assembly should be 2-6 hours max for reasonable batch sizes)
  const realisticCycles = problematicMOs.filter(cycle => 
    cycle.duration_sec && cycle.duration_sec <= 21600 // 6 hours max
  );
  
  console.log(`📊 Realistic cycles (≤6 hours): ${realisticCycles.length}`);
  console.log(`📊 Inflated cycles (>6 hours): ${problematicMOs.length - realisticCycles.length}`);
  
  if (realisticCycles.length > 0) {
    const realisticAvg = realisticCycles.reduce((sum, cycle) => sum + (cycle.duration_sec || 0), 0) / realisticCycles.length;
    console.log(`📊 Realistic average duration: ${(realisticAvg / 3600).toFixed(2)} hours`);
    
    // Calculate what UPH would be with realistic data
    const sampleQuantity = 50; // From the MOs we saw
    const expectedUPH = sampleQuantity / (realisticAvg / 3600);
    console.log(`📈 Expected UPH with realistic data: ${expectedUPH.toFixed(2)}`);
  }
}

// Run the investigation
fixDurationInflation().catch(console.error);