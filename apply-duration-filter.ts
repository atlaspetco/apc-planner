#!/usr/bin/env npx tsx

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { workCycles, operatorUph } from './shared/schema.ts';
import { gt, and, eq } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function applyDurationFilter() {
  console.log('🔧 Applying duration filter to fix inflated UPH values...');
  
  // Flag cycles with duration > 6 hours (21,600 seconds) as data_corrupted
  const suspiciousCycles = await db.update(workCycles)
    .set({ data_corrupted: true })
    .where(gt(workCycles.duration_sec, 21600));
  
  console.log(`🏷️ Flagged ${suspiciousCycles.rowCount} cycles as corrupted (>6 hours)`);
  
  // Get count of remaining valid cycles
  const validCycles = await db.select().from(workCycles)
    .where(eq(workCycles.data_corrupted, false));
  
  console.log(`✅ ${validCycles.length} cycles remain as valid data`);
  
  // Clear existing UPH calculations
  await db.delete(operatorUph);
  console.log('🗑️ Cleared existing UPH calculations');
  
  console.log('🔄 Ready for UPH recalculation with filtered data...');
  console.log('   Expected result: UPH values closer to realistic ranges (Assembly ~10-25 UPH)');
}

// Run the filter
applyDurationFilter().catch(console.error);