/**
 * Comprehensive UPH workflow implementation
 * Handles: Work cycles import → Duration aggregation → UPH calculation
 */

import { FulfilAPIService } from "./fulfil-api.js";
import { db } from "./db.js";
import { workCycles, uphData, productionOrders } from "../shared/schema.js";
import { eq, sql, inArray } from "drizzle-orm";

export class FulfilUphWorkflow {
  private fulfilAPI: FulfilAPIService;

  constructor() {
    this.fulfilAPI = new FulfilAPIService();
    if (process.env.FULFIL_ACCESS_TOKEN) {
      this.fulfilAPI.setApiKey(process.env.FULFIL_ACCESS_TOKEN);
    }
  }

  /**
   * Step 1: Pull new 'done' work cycles from Fulfil
   */
  async importDoneWorkCycles(): Promise<{ imported: number; updated: number }> {
    console.log("Importing 'done' work cycles from Fulfil...");
    
    try {
      // Fetch only the most recent cycles (limit 500 - API maximum)
      const recentCycles = await this.fulfilAPI.getWorkCycles({
        limit: 500,
        offset: 0
      });
      
      console.log(`Fetched ${recentCycles.length} recent cycles from API`);
      
      // Find max cycle ID in database to determine which cycles to import
      const maxCycleQuery = await db.select()
        .from(workCycles)
        .orderBy(sql`${workCycles.work_cycles_id} DESC`)
        .limit(1);
      
      const maxDbCycleId = maxCycleQuery[0]?.work_cycles_id || 0;
      console.log(`Max cycle ID in database: ${maxDbCycleId}`);
      
      // Also check for missing cycles within the current range (for July 8th cycles)
      const missingCycleIds = [26716, 26721, 26723, 26724];
      const existingCycles = await db.select({ id: workCycles.work_cycles_id })
        .from(workCycles)
        .where(inArray(workCycles.work_cycles_id, missingCycleIds));
      
      const existingIds = existingCycles.map(c => c.id);
      const actuallyMissingIds = missingCycleIds.filter(id => !existingIds.includes(id));
      
      console.log(`Checking for missing July 8th cycles: ${missingCycleIds.join(', ')}`);
      console.log(`Found ${actuallyMissingIds.length} missing cycles: ${actuallyMissingIds.join(', ')}`);
      
      // Filter for cycles newer than what's in database
      const newCycles = recentCycles.filter(cycle => cycle.id > maxDbCycleId);
      console.log(`Found ${newCycles.length} new cycles to import (ID > ${maxDbCycleId})`);
      
      // Add missing cycles to the import list
      const missingCycles = recentCycles.filter(cycle => actuallyMissingIds.includes(cycle.id));
      console.log(`Found ${missingCycles.length} missing cycles to import`);
      
      // Look for Evan Crosby's cycles specifically
      const allCycles = [...newCycles, ...missingCycles];
      const evanCycles = allCycles.filter(cycle => cycle.rec_name && cycle.rec_name.includes("Evan Crosby"));
      console.log(`Found ${evanCycles.length} Evan Crosby cycles in data to import`);
      
      const rawCycles = allCycles;

      // Deduplicate by cycle ID first
      const cycleMap = new Map();
      for (const cycle of rawCycles) {
        const cycleId = cycle.id;
        if (cycleId && !cycleMap.has(cycleId.toString())) {
          cycleMap.set(cycleId.toString(), cycle);
        }
      }
      
      console.log(`After deduplication: ${cycleMap.size} unique cycles from ${rawCycles.length} total`);

      let imported = 0;
      let updated = 0;

      for (const cycle of cycleMap.values()) {
        const cycleId = cycle.id;
        
        // Parse operator and work center from rec_name (e.g., "Assembly - Rope | Evan Crosby | Rope")
        const recParts = cycle.rec_name?.split(' | ') || [];
        const operationName = recParts[0] || '';
        const operatorName = recParts[1] || '';
        const workCenterName = recParts[2] || '';
        
        const durationField = cycle.duration;
        
        // Debug what we're getting from the API
        if (cycleId >= 26716 && cycleId <= 26724) {
          console.log(`Raw cycle object for ${cycleId}:`, JSON.stringify(cycle, null, 2));
        }
        
        if (!operatorName || !workCenterName || !cycleId) {
          console.log(`Skipping cycle ${cycleId}: operatorName=${operatorName}, workCenterName=${workCenterName}, durationField=${JSON.stringify(durationField)}`);
          continue; // Skip cycles without essential data
        }

        // Parse duration from various Fulfil formats
        let parsedDuration = 0;
        if (typeof durationField === 'number') {
          parsedDuration = durationField;
        } else if (typeof durationField === 'object') {
          // Handle Fulfil's timedelta format
          if (durationField.seconds) {
            parsedDuration = durationField.seconds;
          } else if (durationField.__class__ === 'timedelta' && durationField.iso_string) {
            // Parse ISO string format PT58M44.170763S
            const timeMatch = durationField.iso_string.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
            if (timeMatch) {
              const minutes = parseInt(timeMatch[1] || '0');
              const seconds = parseFloat(timeMatch[2] || '0');
              parsedDuration = minutes * 60 + seconds;
            }
          }
        } else if (typeof durationField === 'string') {
          try {
            const parsed = JSON.parse(durationField);
            parsedDuration = parsed.seconds || 0;
          } catch {
            parsedDuration = parseFloat(durationField) || 0;
          }
        }
        
        // Debug duration parsing for July 8th cycles
        if (cycleId >= 26716 && cycleId <= 26724) {
          console.log(`July 8th cycle ${cycleId} (${operatorName}) duration field:`, JSON.stringify(durationField));
          console.log(`Duration type: ${typeof durationField}, has __class__: ${durationField?.__class__}`);
          console.log(`Parsed duration: ${parsedDuration}`);
        }

        // Check if cycle already exists
        let existingCycle = [];
        try {
          existingCycle = await db.select()
            .from(workCycles)
            .where(eq(workCycles.work_cycles_id, parseInt(cycleId)))
            .limit(1);
        } catch (error) {
          console.error(`Error checking existing cycle ${cycleId}:`, error);
          continue;
        }

        // Parse write_date from various Fulfil formats
        let parsedWriteDate = new Date();
        if (cycle.write_date) {
          if (typeof cycle.write_date === 'string') {
            parsedWriteDate = new Date(cycle.write_date);
          } else if (typeof cycle.write_date === 'object' && cycle.write_date.iso_string) {
            parsedWriteDate = new Date(cycle.write_date.iso_string);
          } else {
            parsedWriteDate = new Date(cycle.write_date);
          }
        }

        const cycleData = {
          work_cycles_id: parseInt(cycleId),
          work_cycles_operator_rec_name: operatorName,
          work_cycles_work_center_rec_name: workCenterName,
          work_cycles_duration: parsedDuration,
          work_cycles_quantity_done: cycle.quantity_done || 0, // Add the critical quantity field
          work_production_id: null, // Will be populated later if needed
          work_cycles_rec_name: cycle.rec_name || `Work Cycle ${cycleId}`,
          work_cycles_operator_write_date: parsedWriteDate,
          state: 'done'
        };

        try {
          if (existingCycle.length === 0) {
            await db.insert(workCycles).values(cycleData);
            imported++;
            if (operatorName === 'Evan Crosby') {
              console.log(`Successfully imported Evan cycle ${cycleId}`);
            }
          } else {
            await db.update(workCycles)
              .set({ ...cycleData, updatedAt: new Date() })
              .where(eq(workCycles.work_cycles_id, parseInt(cycleId)));
            updated++;
            if (operatorName === 'Evan Crosby') {
              console.log(`Successfully updated Evan cycle ${cycleId}`);
            }
          }
        } catch (error) {
          console.error(`Error inserting/updating cycle ${cycleId}:`, error);
          if (operatorName === 'Evan Crosby') {
            console.error(`Failed to process Evan cycle ${cycleId}:`, error);
          }
        }
      }

      console.log(`Work cycles import complete: ${imported} new, ${updated} updated`);
      return { imported, updated };
    } catch (error) {
      console.error("Error importing work cycles:", error);
      throw error;
    }
  }

  /**
   * Step 2: Aggregate duration for work cycles by work center + routing
   * Use production.id to get MO quantity and sum durations
   */
  async aggregateWorkCycleDurations(): Promise<Array<{
    workCenter: string;
    routing: string;
    operator: string;
    totalDurationSeconds: number;
    totalQuantity: number;
    cycleCount: number;
  }>> {
    console.log("Aggregating work cycle durations by work center + routing...");

    try {
      // Query aggregated data using SQL for efficiency
      // Use authentic quantity_done from work cycles and include ALL manufacturing time (setup + production)
      const aggregatedData = await db.execute(sql`
        SELECT 
          CASE 
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Assembly%' THEN 'Assembly'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Sewing%' AND wc.work_cycles_work_center_rec_name NOT LIKE '%Assembly%' THEN 'Sewing'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Cutting%' THEN 'Cutting'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Packaging%' THEN 'Packaging'
            ELSE wc.work_cycles_work_center_rec_name 
          END as work_center,
          COALESCE(po.routing, 
            CASE 
              WHEN wc.work_production_routing_rec_name IS NOT NULL THEN wc.work_production_routing_rec_name
              ELSE 'Standard'
            END
          ) as routing,
          wc.work_cycles_operator_rec_name as operator,
          SUM(wc.work_cycles_duration) as total_duration_seconds,
          SUM(wc.work_cycles_quantity_done) as total_quantity,
          COUNT(wc.work_cycles_id) as cycle_count
        FROM ${workCycles} wc
        LEFT JOIN ${productionOrders} po ON wc.work_production_id = po.fulfil_id
        WHERE wc.work_cycles_operator_rec_name != 'Unknown'
          AND wc.work_cycles_work_center_rec_name != 'Unknown'
        GROUP BY 
          CASE 
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Assembly%' THEN 'Assembly'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Sewing%' AND wc.work_cycles_work_center_rec_name NOT LIKE '%Assembly%' THEN 'Sewing'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Cutting%' THEN 'Cutting'
            WHEN wc.work_cycles_work_center_rec_name LIKE '%Packaging%' THEN 'Packaging'
            ELSE wc.work_cycles_work_center_rec_name 
          END,
          COALESCE(po.routing, 
            CASE 
              WHEN wc.work_production_routing_rec_name IS NOT NULL THEN wc.work_production_routing_rec_name
              ELSE 'Standard'
            END
          ),
          wc.work_cycles_operator_rec_name
        HAVING SUM(wc.work_cycles_quantity_done) > 0
        ORDER BY total_quantity DESC
      `);

      const results = aggregatedData.rows.map(row => ({
        workCenter: row.work_center as string,
        routing: row.routing as string,
        operator: row.operator as string,
        totalDurationSeconds: parseInt(row.total_duration_seconds as string),
        totalQuantity: parseInt(row.total_quantity as string),
        cycleCount: parseInt(row.cycle_count as string)
      }));

      console.log(`Aggregated ${results.length} work center + routing combinations`);
      return results;
    } catch (error) {
      console.error("Error aggregating work cycle durations:", error);
      throw error;
    }
  }

  /**
   * Step 3: Calculate UPH per Operator for each Routing + Work Center combination
   * Convert seconds to hours and calculate units per hour
   */
  async calculateUphFromAggregatedData(): Promise<{ calculated: number; skipped: number }> {
    console.log("Calculating UPH from aggregated work cycle data...");

    try {
      const aggregatedData = await this.aggregateWorkCycleDurations();
      let calculated = 0;
      let skipped = 0;

      // Clear existing UPH data to recalculate fresh
      await db.delete(uphData);

      for (const data of aggregatedData) {
        const durationHours = data.totalDurationSeconds / 3600; // Convert seconds to hours
        
        if (durationHours > 0 && data.totalQuantity > 0) {
          const uph = data.totalQuantity / durationHours;
          
          // Only store realistic UPH values (between 2 and 300) - filter outliers
          if (uph >= 2 && uph <= 300) {
            await db.insert(uphData).values({
              operatorName: data.operator,
              workCenter: data.workCenter,
              productRouting: data.routing || 'Standard',
              operation: `${data.workCenter} Operations`,
              uph: Math.round(uph * 10) / 10, // Round to 1 decimal place
              observationCount: data.cycleCount,
              totalDurationHours: Math.round(durationHours * 10) / 10,
              totalQuantity: data.totalQuantity,
              dataSource: 'work_cycles_aggregated'
            });
            calculated++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
      }

      console.log(`UPH calculation complete: ${calculated} calculated, ${skipped} skipped`);
      return { calculated, skipped };
    } catch (error) {
      console.error("Error calculating UPH:", error);
      throw error;
    }
  }

  /**
   * Execute complete UPH workflow: Import → Aggregate → Calculate
   */
  async executeCompleteWorkflow(): Promise<{
    workCycles: { imported: number; updated: number };
    uphData: { calculated: number; skipped: number };
    totalProcessingTime: number;
  }> {
    const startTime = Date.now();
    console.log("Starting complete UPH workflow...");

    try {
      // Step 1: Import done work cycles
      const workCyclesResult = await this.importDoneWorkCycles();
      
      // Step 2 & 3: Aggregate and calculate UPH (combined for efficiency)
      const uphResult = await this.calculateUphFromAggregatedData();
      
      const totalProcessingTime = Date.now() - startTime;
      
      console.log(`Complete UPH workflow finished in ${totalProcessingTime}ms`);
      
      return {
        workCycles: workCyclesResult,
        uphData: uphResult,
        totalProcessingTime
      };
    } catch (error) {
      console.error("Error in complete UPH workflow:", error);
      throw error;
    }
  }
}