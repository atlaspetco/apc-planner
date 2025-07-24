/**
 * Simplified Database-Driven UPH Consolidation
 * 
 * Uses proper Drizzle ORM methods for reliable data processing
 */

import { db } from '../db.js';
import { workCycles, uphData } from '../../shared/schema.js';
import { eq, isNotNull, and } from 'drizzle-orm';

interface SimplifiedStats {
  totalCycles: number;
  validCycles: number;
  uphCalculationsGenerated: number;
}

export async function executeSimplifiedConsolidation(): Promise<{
  success: boolean;
  stats: SimplifiedStats;
  message: string;
}> {
  
  console.log('🚀 Starting simplified database consolidation...');
  
  try {
    // Step 1: Get all work cycles from database
    const allCycles = await db.select().from(workCycles);
    
    console.log(`📊 Total cycles in database: ${allCycles.length}`);
    
    // Filter for valid cycles - be more lenient to include authentic data
    const validCycles = allCycles.filter(cycle => 
      cycle.duration_sec && 
      cycle.duration_sec > 0 &&
      cycle.work_cycles_operator_rec_name && // Must have operator name
      cycle.work_production_routing_rec_name // Must have routing
      // Remove quantity filter - it may be null/0 for some cycles
      // Include all cycles regardless of data_corrupted flag since they contain authentic measurements
    );
    console.log(`📊 Valid cycles after filtering: ${validCycles.length}`);
    
    // Debug filtering logic
    const withDuration = allCycles.filter(c => c.duration_sec && c.duration_sec > 0);
    const withOperator = allCycles.filter(c => c.work_cycles_operator_rec_name);
    const withRouting = allCycles.filter(c => c.work_production_routing_rec_name);
    
    console.log('🔍 Debug filtering:');
    console.log(`  - Cycles with duration > 0: ${withDuration.length}`);
    console.log(`  - Cycles with operator: ${withOperator.length}`);
    console.log(`  - Cycles with routing: ${withRouting.length}`);
    
    if (validCycles.length > 0) {
      console.log('📋 Sample valid cycle:', {
        operator: validCycles[0].work_cycles_operator_rec_name,
        workCenter: validCycles[0].work_cycles_work_center_rec_name,
        routing: validCycles[0].work_production_routing_rec_name,
        duration: validCycles[0].duration_sec,
        quantity: validCycles[0].work_production_quantity
      });
    } else if (allCycles.length > 0) {
      console.log('📋 Sample raw cycle (for debugging):', {
        operator: allCycles[0].work_cycles_operator_rec_name,
        workCenter: allCycles[0].work_cycles_work_center_rec_name,
        routing: allCycles[0].work_production_routing_rec_name,
        duration: allCycles[0].duration_sec,
        quantity: allCycles[0].work_production_quantity
      });
    }
    
    console.log(`📊 Found ${validCycles.length} valid work cycles`);
    
    // Step 2: Group cycles by operator + work center + routing
    const groupedData = new Map<string, {
      operator: string;
      workCenter: string;
      routing: string;
      totalDuration: number;
      totalQuantity: number;
      cycleCount: number;
    }>();
    
    for (const cycle of validCycles) {
      const key = `${cycle.work_cycles_operator_rec_name}-${cycle.work_cycles_work_center_rec_name}-${cycle.work_production_routing_rec_name}`;
      
      if (!groupedData.has(key)) {
        groupedData.set(key, {
          operator: cycle.work_cycles_operator_rec_name || '',
          workCenter: cycle.work_cycles_work_center_rec_name || '',
          routing: cycle.work_production_routing_rec_name || '',
          totalDuration: 0,
          totalQuantity: 0,
          cycleCount: 0
        });
      }
      
      const group = groupedData.get(key)!;
      group.totalDuration += cycle.duration_sec || 0;
      group.totalQuantity += cycle.work_production_quantity || 0;
      group.cycleCount += 1;
    }
    
    console.log(`🔄 Consolidated into ${groupedData.size} unique operator/work center/routing combinations`);
    
    // Step 3: Clear existing UPH data and calculate new values
    await db.delete(uphData);
    
    let uphCalculationsGenerated = 0;
    
    for (const [key, group] of groupedData.entries()) {
      if (group.totalDuration > 0 && group.totalQuantity > 0) {
        const durationHours = group.totalDuration / 3600;
        const uph = group.totalQuantity / durationHours;
        
        // Filter realistic UPH values
        if (uph > 0 && uph < 1000 && durationHours > 0.05) {
          await db.insert(uphData).values({
            operatorName: group.operator,
            workCenter: group.workCenter,
            operation: group.workCenter,
            productRouting: group.routing, // Correct field name from schema
            uph: parseFloat(uph.toFixed(2)),
            observationCount: group.cycleCount,
            totalDurationHours: parseFloat(durationHours.toFixed(2)),
            totalQuantity: group.totalQuantity,
            dataSource: 'consolidated_simplified'
          });
          uphCalculationsGenerated++;
        }
      }
    }
    
    const stats: SimplifiedStats = {
      totalCycles: allCycles.length,
      validCycles: validCycles.length,
      uphCalculationsGenerated
    };
    
    console.log('✅ Simplified consolidation completed successfully!');
    console.log(`📊 Processed ${allCycles.length} cycles`);
    console.log(`📈 Generated ${uphCalculationsGenerated} UPH calculations`);
    
    return {
      success: true,
      stats,
      message: `Successfully processed ${allCycles.length} work cycles and generated ${uphCalculationsGenerated} UPH calculations`
    };
    
  } catch (error: any) {
    console.error('❌ Simplified consolidation failed:', error);
    return {
      success: false,
      stats: {
        totalCycles: 0,
        validCycles: 0,
        uphCalculationsGenerated: 0
      },
      message: `Consolidation failed: ${error?.message || 'Unknown error'}`
    };
  }
}