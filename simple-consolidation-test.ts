/**
 * Simple test to verify consolidated UPH rebuild approach
 * Tests the core logic without pandas dependencies
 */

import { db } from './server/db.js';
import { workCycles, uphData } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function testConsolidatedApproach() {
  console.log('🧪 Testing consolidated UPH rebuild approach...');
  
  try {
    // 1. Check current work cycles data
    const currentCycles = await db.select().from(workCycles).limit(10);
    console.log(`📊 Current work cycles in database: ${currentCycles.length} (showing first 10)`);
    
    if (currentCycles.length > 0) {
      console.log('Sample cycle:', {
        id: currentCycles[0].work_cycles_id,
        operator: currentCycles[0].work_cycles_operator_rec_name,
        workCenter: currentCycles[0].work_cycles_work_center_rec_name,
        routing: currentCycles[0].work_production_routing_rec_name,
        duration: currentCycles[0].duration_sec,
        quantity: currentCycles[0].work_production_quantity
      });
    }
    
    // 2. Test consolidation concept - group identical work/operator/routing combinations
    const consolidationQuery = sql`
      SELECT 
        work_cycles_operator_rec_name as operator,
        work_cycles_work_center_rec_name as work_center,
        work_production_routing_rec_name as routing,
        work_production_id as mo_id,
        COUNT(*) as cycle_count,
        SUM(duration_sec) as total_duration_sec,
        MAX(work_production_quantity) as quantity
      FROM work_cycles 
      WHERE duration_sec IS NOT NULL 
        AND work_cycles_operator_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND data_corrupted = false
      GROUP BY 
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name, 
        work_production_routing_rec_name,
        work_production_id
      HAVING COUNT(*) > 1
      ORDER BY cycle_count DESC
      LIMIT 10
    `;
    
    const consolidationResults = await db.execute(consolidationQuery);
    console.log(`🔄 Found ${consolidationResults.length} groups with multiple cycles (consolidation candidates)`);
    
    if (consolidationResults.length > 0) {
      console.log('Top consolidation candidate:', consolidationResults[0]);
      
      // Calculate UPH for this example
      const example = consolidationResults[0];
      const uph = (example.quantity * 3600) / example.total_duration_sec;
      console.log(`📈 Example UPH calculation: ${example.quantity} units ÷ ${(example.total_duration_sec / 3600).toFixed(2)}h = ${uph.toFixed(2)} UPH`);
    }
    
    // 3. Check current UPH data quality
    const currentUph = await db.select().from(uphData).limit(5);
    console.log(`📈 Current UPH calculations: ${currentUph.length} (showing first 5)`);
    
    if (currentUph.length > 0) {
      console.log('Sample UPH:', {
        operator: currentUph[0].operatorName,
        workCenter: currentUph[0].workCenter,
        routing: currentUph[0].routing,
        uph: currentUph[0].uph,
        observations: currentUph[0].observationCount
      });
    }
    
    console.log('✅ Consolidation test completed - ready for full implementation');
    return true;
    
  } catch (error: any) {
    console.error('❌ Consolidation test failed:', error?.message);
    return false;
  }
}

// Run test
testConsolidatedApproach();