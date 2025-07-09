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
      // Fetch work cycles with 'done' state
      const cycles = await this.fulfilAPI.getWorkCycles({
        state: 'done',
        limit: 500
      });

      let imported = 0;
      let updated = 0;

      for (const cycle of cycles) {
        const existingCycle = await db.select()
          .from(workCycles)
          .where(eq(workCycles.work_cycles_id, parseInt(cycle.id)))
          .limit(1);

        const cycleData = {
          work_cycles_id: parseInt(cycle.id),
          work_cycles_operator_rec_name: cycle.operator?.rec_name || 'Unknown',
          work_cycles_work_center_rec_name: cycle.work_center?.rec_name || 'Unknown',
          work_cycles_duration: cycle.duration || 0,
          work_production_id: cycle.production?.id || null,
          work_cycles_rec_name: cycle.rec_name || `Work Cycle ${cycle.id}`,
          state: 'done',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        if (existingCycle.length === 0) {
          await db.insert(workCycles).values(cycleData);
          imported++;
        } else {
          await db.update(workCycles)
            .set({ ...cycleData, updatedAt: new Date() })
            .where(eq(workCycles.work_cycles_id, parseInt(cycle.id)));
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
      const aggregatedData = await db.execute(sql`
        SELECT 
          wc.work_cycles_work_center_rec_name as work_center,
          po.routing as routing,
          wc.work_cycles_operator_rec_name as operator,
          SUM(wc.work_cycles_duration) as total_duration_seconds,
          SUM(po.quantity) as total_quantity,
          COUNT(wc.work_cycles_id) as cycle_count
        FROM ${workCycles} wc
        LEFT JOIN ${productionOrders} po ON wc.work_production_id = po.fulfil_id
        WHERE wc.state = 'done' 
          AND wc.work_cycles_duration > 120
          AND po.quantity > 0
        GROUP BY 
          wc.work_cycles_work_center_rec_name,
          po.routing,
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
              dataSource: 'work_cycles_aggregated',
              createdAt: new Date(),
              updatedAt: new Date()
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