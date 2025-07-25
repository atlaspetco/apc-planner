import { db } from './server/db';
import { workCycles } from './shared/schema';
import { sql } from 'drizzle-orm';

async function checkWorkCyclesStatus() {
  try {
    // Count total records
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(workCycles);
    
    console.log('Total work cycles in database:', countResult[0].count);
    
    // Get sample records if any exist
    const samples = await db.select()
      .from(workCycles)
      .limit(5);
    
    console.log('Sample records:', samples.length);
    if (samples.length > 0) {
      console.log('First record:', JSON.stringify(samples[0], null, 2));
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking work cycles:', error);
    process.exit(1);
  }
}

checkWorkCyclesStatus();