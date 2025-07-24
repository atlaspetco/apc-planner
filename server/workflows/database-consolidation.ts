/**
 * Database-Driven UPH Consolidation Workflow
 * 
 * This replaces the pandas approach with direct SQL consolidation:
 * 1. Identify duplicate work cycles using SQL GROUP BY
 * 2. Consolidate durations by summing grouped cycles  
 * 3. Clear corrupted data and rebuild with consolidated values
 * 4. Calculate accurate UPH from consolidated durations
 * 5. Update UPH tables with corrected calculations
 */

import { db } from '../db.js';
import { workCycles, uphData } from '../../shared/schema.js';
import { sql, eq, and, isNotNull, gt } from 'drizzle-orm';

interface ConsolidationStats {
  originalCycles: number;
  duplicateGroups: number;
  consolidatedCycles: number;
  compressionRatio: string;
  uphCalculationsGenerated: number;
}

interface ConsolidationResult {
  success: boolean;
  stats: ConsolidationStats;
  message: string;
}

/**
 * Execute database-driven consolidation workflow
 */
export async function executeDatabaseConsolidation(): Promise<ConsolidationResult> {
  console.log('🚀 Starting database-driven UPH consolidation...');
  
  try {
    // Step 1: Count original work cycles
    const originalCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
    const originalCycles = originalCount[0]?.count || 0;
    console.log(`📊 Original work cycles: ${originalCycles}`);
    
    // Step 2: Identify duplicate groups (same operator+work_center+routing+mo_id with multiple cycles)
    const duplicateGroupsQuery = sql`
      SELECT 
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name,
        work_production_routing_rec_name,
        work_production_id,
        COUNT(*) as cycle_count,
        SUM(duration_sec) as total_duration_sec,
        MAX(work_production_quantity) as quantity
      FROM work_cycles 
      WHERE duration_sec IS NOT NULL 
        AND work_cycles_operator_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_production_id IS NOT NULL
      GROUP BY 
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name,
        work_production_routing_rec_name,
        work_production_id
      HAVING COUNT(*) > 1
      ORDER BY cycle_count DESC
    `;
    
    const duplicateGroupsResult = await db.execute(duplicateGroupsQuery);
    const duplicateGroups = duplicateGroupsResult.rows || [];
    console.log(`🔄 Found ${duplicateGroups.length} groups with duplicate cycles`);
    
    // Step 3: Create consolidated work cycles table
    console.log('🛠️ Creating consolidated work cycles...');
    
    // Clear existing consolidated cycles
    await db.delete(workCycles).where(eq(workCycles.data_corrupted, false));
    
    // Step 4: Generate consolidated cycles from groups
    let consolidatedCount = 0;
    
    // First, handle non-duplicate cycles (keep as-is)
    const singleCyclesQuery = sql`
      SELECT DISTINCT
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name,
        work_production_routing_rec_name,
        work_production_id,
        duration_sec,
        work_production_quantity,
        work_production_create_date,
        work_rec_name,
        work_cycles_id
      FROM work_cycles 
      WHERE duration_sec IS NOT NULL 
        AND work_cycles_operator_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND work_production_id IS NOT NULL
        AND (work_cycles_operator_rec_name, work_cycles_work_center_rec_name, work_production_routing_rec_name, work_production_id) 
        NOT IN (
          SELECT 
            work_cycles_operator_rec_name,
            work_cycles_work_center_rec_name,
            work_production_routing_rec_name,
            work_production_id
          FROM work_cycles 
          WHERE duration_sec IS NOT NULL 
          GROUP BY 
            work_cycles_operator_rec_name,
            work_cycles_work_center_rec_name,
            work_production_routing_rec_name,
            work_production_id
          HAVING COUNT(*) > 1
        )
    `;
    
    const singleCyclesResult = await db.execute(singleCyclesQuery);
    const singleCycles = singleCyclesResult.rows || [];
    console.log(`📝 Preserving ${singleCycles.length} single cycles`);
    
    // Insert single cycles back
    for (const cycle of singleCycles) {
      await db.insert(workCycles).values({
        work_cycles_id: cycle.work_cycles_id,
        work_cycles_operator_rec_name: cycle.work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name: cycle.work_cycles_work_center_rec_name,
        duration_sec: cycle.duration_sec,
        work_production_id: cycle.work_production_id,
        work_production_routing_rec_name: cycle.work_production_routing_rec_name,
        work_production_quantity: cycle.work_production_quantity,
        work_production_create_date: cycle.work_production_create_date || new Date(),
        work_rec_name: cycle.work_rec_name,
        data_corrupted: false
      });
      consolidatedCount++;
    }
    
    // Insert consolidated cycles from duplicate groups
    for (const group of duplicateGroups) {
      await db.insert(workCycles).values({
        work_cycles_id: Math.floor(Math.random() * 1000000), // Generate unique ID for consolidated cycle
        work_cycles_operator_rec_name: group.work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name: group.work_cycles_work_center_rec_name,
        duration_sec: group.total_duration_sec, // Consolidated duration
        work_production_id: group.work_production_id,
        work_production_routing_rec_name: group.work_production_routing_rec_name,
        work_production_quantity: group.quantity,
        work_production_create_date: new Date(),
        work_rec_name: `Consolidated-${group.work_production_id}`,
        data_corrupted: false
      });
      consolidatedCount++;
    }
    
    console.log(`✅ Created ${consolidatedCount} consolidated cycles`);
    
    // Step 5: Calculate UPH from consolidated data
    console.log('📈 Calculating UPH from consolidated data...');
    
    // Clear existing UPH calculations
    await db.delete(uphData);
    
    // Calculate new UPH values using consolidated durations
    const uphCalculationQuery = sql`
      SELECT 
        work_cycles_operator_rec_name as operator_name,
        work_cycles_work_center_rec_name as work_center,
        work_production_routing_rec_name as routing,
        SUM(work_production_quantity) as total_quantity,
        SUM(duration_sec) as total_duration_sec,
        COUNT(*) as observation_count
      FROM work_cycles 
      WHERE duration_sec IS NOT NULL 
        AND work_cycles_operator_rec_name IS NOT NULL
        AND work_production_routing_rec_name IS NOT NULL
        AND data_corrupted = false
      GROUP BY 
        work_cycles_operator_rec_name,
        work_cycles_work_center_rec_name,
        work_production_routing_rec_name
      HAVING SUM(duration_sec) > 0
    `;
    
    const uphGroupsResult = await db.execute(uphCalculationQuery);
    const uphGroups = uphGroupsResult.rows || [];
    console.log(`🧮 Calculating UPH for ${uphGroups.length} operator/work center/routing combinations`);
    
    let uphCalculationsGenerated = 0;
    
    for (const group of uphGroups) {
      const durationHours = group.total_duration_sec / 3600;
      const uph = group.total_quantity / durationHours;
      
      // Filter out extreme outliers (likely still corrupted data)
      if (uph > 0 && uph < 1000 && durationHours > 0.05) { // Min 3 minutes total duration
        await db.insert(uphData).values({
          operatorId: null, // Will be resolved by name lookup
          operatorName: group.operator_name,
          workCenter: group.work_center,
          operation: group.work_center, // Use work center as operation for simplicity
          routing: group.routing,
          uph: parseFloat(uph.toFixed(2)),
          observationCount: group.observation_count,
          totalDurationHours: parseFloat(durationHours.toFixed(2)),
          totalQuantity: group.total_quantity,
          dataSource: 'consolidated_cycles',
          lastUpdated: new Date()
        });
        uphCalculationsGenerated++;
      }
    }
    
    const compressionRatio = ((1 - consolidatedCount / originalCycles) * 100).toFixed(1);
    
    const stats: ConsolidationStats = {
      originalCycles,
      duplicateGroups: duplicateGroups.length,
      consolidatedCycles: consolidatedCount,
      compressionRatio: `${compressionRatio}%`,
      uphCalculationsGenerated
    };
    
    console.log('✅ Database consolidation completed successfully!');
    console.log(`📊 Original cycles: ${originalCycles}`);
    console.log(`📊 Duplicate groups: ${duplicateGroups.length}`);
    console.log(`📊 Consolidated cycles: ${consolidatedCount}`);
    console.log(`📊 Compression ratio: ${compressionRatio}%`);
    console.log(`📈 UPH calculations generated: ${uphCalculationsGenerated}`);
    
    return {
      success: true,
      stats,
      message: `Successfully consolidated ${originalCycles} work cycles into ${consolidatedCount} clean cycles with ${uphCalculationsGenerated} UPH calculations`
    };
    
  } catch (error: any) {
    console.error('❌ Database consolidation failed:', error);
    return {
      success: false,
      stats: {
        originalCycles: 0,
        duplicateGroups: 0,
        consolidatedCycles: 0,
        compressionRatio: '0%',
        uphCalculationsGenerated: 0
      },
      message: `Consolidation failed: ${error?.message || 'Unknown error'}`
    };
  }
}