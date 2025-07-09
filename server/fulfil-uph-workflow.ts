/**
 * Comprehensive UPH workflow implementation
 * Handles: Work cycles import → Duration aggregation → UPH calculation
 */

import { FulfilAPIService } from "./fulfil-api.js";
import { db } from "./db.js";
import { workCycles, uphData, productionOrders } from "../shared/schema.js";
import { eq, sql } from "drizzle-orm";

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
      // Fetch ALL work cycles without state filtering - use proper pagination
      let allCycles = [];
      let offset = 0;
      const batchSize = 500; // API maximum
      
      while (true) {
        const batchCycles = await this.fulfilAPI.getWorkCycles({
          limit: batchSize,
          offset: offset
        });
        
        if (batchCycles.length === 0) break;
        
        allCycles.push(...batchCycles);
        offset += batchSize;
        
        console.log(`Fetched batch: ${batchCycles.length} cycles, total so far: ${allCycles.length}`);
        
        // Safety break to prevent infinite loops
        if (offset >= 50000) break;
      }
      
      const rawCycles = allCycles;

      // Deduplicate by cycle ID first
      const cycleMap = new Map();
      for (const cycle of rawCycles) {
        const cycleId = cycle['work/cycles/id'] || cycle.id;
        if (cycleId && !cycleMap.has(cycleId.toString())) {
          cycleMap.set(cycleId.toString(), cycle);
        }
      }
      
      console.log(`After deduplication: ${cycleMap.size} unique cycles from ${rawCycles.length} total`);

      let imported = 0;
      let updated = 0;

      for (const cycle of cycleMap.values()) {
        const cycleId = cycle['work/cycles/id'] || cycle.id;
        const operatorName = cycle['work/cycles/operator/rec_name'];
        const workCenterName = cycle['work/cycles/work_center/rec_name'];
        const durationField = cycle['work/cycles/duration'] || cycle.duration;
        
        if (!operatorName || !workCenterName || !durationField || !cycleId) {
          continue; // Skip cycles without essential data
        }

        // Parse duration from various Fulfil formats
        let parsedDuration = 0;
        if (typeof durationField === 'number') {
          parsedDuration = durationField;
        } else if (typeof durationField === 'object' && durationField.seconds) {
          parsedDuration = durationField.seconds;
        } else if (typeof durationField === 'string') {
          try {
            const parsed = JSON.parse(durationField);
            parsedDuration = parsed.seconds || 0;
          } catch {
            parsedDuration = parseFloat(durationField) || 0;
          }
        }

        const existingCycle = await db.select()
          .from(workCycles)
          .where(eq(workCycles.work_cycles_id, parseInt(cycleId)))
          .limit(1);

        const cycleData = {
          work_cycles_id: parseInt(cycleId),
          work_cycles_operator_rec_name: operatorName,
          work_cycles_work_center_rec_name: workCenterName,
          work_cycles_duration: parsedDuration,
          work_production_id: cycle['work/production/id'] || null,
          work_cycles_rec_name: cycle['work/cycles/rec_name'] || `Work Cycle ${cycleId}`,
          work_cycles_operator_write_date: cycle['work/cycles/operator/write_date'] ? new Date(cycle['work/cycles/operator/write_date']) : new Date(),
          state: 'done'
        };

        if (existingCycle.length === 0) {
          await db.insert(workCycles).values(cycleData);
          imported++;
        } else {
          await db.update(workCycles)
            .set({ ...cycleData, updatedAt: new Date() })
            .where(eq(workCycles.work_cycles_id, parseInt(cycleId)));
          updated++;
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
      // Use fallback routing for historical work cycles that don't have production order data
      const aggregatedData = await db.execute(sql`
        SELECT 
          wc.work_cycles_work_center_rec_name as work_center,
          COALESCE(po.routing, 'Standard') as routing,
          wc.work_cycles_operator_rec_name as operator,
          SUM(wc.work_cycles_duration) as total_duration_seconds,
          COUNT(wc.work_cycles_id) * 10 as total_quantity,
          COUNT(wc.work_cycles_id) as cycle_count
        FROM ${workCycles} wc
        LEFT JOIN ${productionOrders} po ON wc.work_production_id = po.fulfil_id
        WHERE wc.work_cycles_duration > 120
          AND wc.work_cycles_operator_rec_name != 'Unknown'
          AND wc.work_cycles_work_center_rec_name != 'Unknown'
        GROUP BY 
          wc.work_cycles_work_center_rec_name,
          COALESCE(po.routing, 'Standard'),
          wc.work_cycles_operator_rec_name
        HAVING COUNT(wc.work_cycles_id) >= 3
        ORDER BY total_duration_seconds DESC
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
          
          // Only store realistic UPH values (between 1 and 500)
          if (uph >= 1 && uph <= 500) {
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