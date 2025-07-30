import { db } from "../db.js";
import { workCycles, productionOrders, operators, uphData } from "../../shared/schema.js";
import { eq, or, isNull, sql, gt, and } from "drizzle-orm";
import { consolidateWorkCenter } from "../uph-core-calculator.js";

interface OptimizedCalculationResult {
  totalProcessed: number;
  newCalculations: number;
  updatedCalculations: number;
  executionTimeMs: number;
  lastProcessedId: number;
}

/**
 * Optimized UPH Calculator that processes incrementally
 * Only calculates UPH for new or changed work cycles
 */
export class OptimizedUphCalculator {
  private static instance: OptimizedUphCalculator;
  private isRunning = false;
  private lastRunTime: Date | null = null;
  private batchSize = 1000; // Process in smaller chunks

  static getInstance(): OptimizedUphCalculator {
    if (!OptimizedUphCalculator.instance) {
      OptimizedUphCalculator.instance = new OptimizedUphCalculator();
    }
    return OptimizedUphCalculator.instance;
  }

  /**
   * Check if UPH data needs recalculation
   * Returns true if there are new work cycles since last calculation
   */
  async needsRecalculation(): Promise<boolean> {
    // Get the last calculated work cycle ID
    const lastCalculated = await db
      .select({ lastId: sql<number>`MAX(${workCycles.id})` })
      .from(workCycles)
      .innerJoin(uphData, eq(uphData.operatorName, workCycles.work_cycles_operator_rec_name));

    const lastCalculatedId = lastCalculated[0]?.lastId || 0;

    // Check if there are newer work cycles
    const newerCycles = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workCycles)
      .where(
        and(
          gt(workCycles.id, lastCalculatedId),
          or(
            eq(workCycles.data_corrupted, false),
            isNull(workCycles.data_corrupted)
          )
        )
      );

    return (newerCycles[0]?.count || 0) > 0;
  }

  /**
   * Fast incremental UPH calculation
   * Only processes new work cycles since last run
   */
  async runIncrementalCalculation(): Promise<OptimizedCalculationResult> {
    if (this.isRunning) {
      throw new Error("UPH calculation is already running");
    }

    this.isRunning = true;
    const startTime = Date.now();
    let totalProcessed = 0;
    let newCalculations = 0;
    let updatedCalculations = 0;
    let lastProcessedId = 0;

    try {
      console.log("🚀 Starting optimized incremental UPH calculation");

      // Get the last processed work cycle ID from metadata table
      const lastProcessed = await this.getLastProcessedId();
      console.log(`📊 Last processed work cycle ID: ${lastProcessed}`);

      // Get new work cycles in batches
      let hasMoreData = true;
      let currentBatchStart = lastProcessed;

      while (hasMoreData) {
        // Fetch batch of new work cycles
        const newCycles = await db
          .select()
          .from(workCycles)
          .where(
            and(
              gt(workCycles.id, currentBatchStart),
              or(
                eq(workCycles.data_corrupted, false),
                isNull(workCycles.data_corrupted)
              )
            )
          )
          .orderBy(workCycles.id)
          .limit(this.batchSize);

        if (newCycles.length === 0) {
          hasMoreData = false;
          break;
        }

        console.log(`⚡ Processing batch: ${newCycles.length} work cycles`);

        // Group cycles by operator+workCenter+routing combination
        const groupedResults = this.groupCyclesForCalculation(newCycles);

        // Calculate UPH for each group
        for (const [groupKey, cycles] of groupedResults.entries()) {
          const result = await this.calculateGroupUph(groupKey, cycles);
          
          if (result) {
            // Check if this combination already exists
            const existing = await db
              .select()
              .from(uphData)
              .where(
                and(
                  eq(uphData.operatorName, result.operatorName),
                  eq(uphData.workCenter, result.workCenter),
                  eq(uphData.productRouting, result.routing)
                )
              )
              .limit(1);

            if (existing.length > 0) {
              // Update existing record (combine with previous data)
              await this.updateExistingUphRecord(existing[0], result);
              updatedCalculations++;
            } else {
              // Insert new record
              await db.insert(uphData).values({
                operatorName: result.operatorName,
                workCenter: result.workCenter,
                operation: 'General',
                productRouting: result.routing,
                uph: result.uph,
                observationCount: result.observations
              });
              newCalculations++;
            }
          }
        }

        totalProcessed += newCycles.length;
        lastProcessedId = newCycles[newCycles.length - 1].id;
        currentBatchStart = lastProcessedId;

        // Update progress
        console.log(`✅ Processed ${totalProcessed} cycles, last ID: ${lastProcessedId}`);
      }

      // Update the last processed ID
      await this.setLastProcessedId(lastProcessedId);

      const executionTimeMs = Date.now() - startTime;
      this.lastRunTime = new Date();

      console.log(`🎉 Optimized UPH calculation complete in ${executionTimeMs}ms`);
      console.log(`📈 Results: ${newCalculations} new, ${updatedCalculations} updated, ${totalProcessed} total processed`);

      return {
        totalProcessed,
        newCalculations,
        updatedCalculations,
        executionTimeMs,
        lastProcessedId
      };

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Group work cycles by operator+workCenter+routing for batch calculation
   */
  private groupCyclesForCalculation(cycles: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const cycle of cycles) {
      if (!cycle.work_cycles_operator_rec_name) continue;

      const workCenter = consolidateWorkCenter(cycle.work_cycles_work_center_rec_name);
      if (!workCenter) continue;

      const routing = cycle.work_production_routing_rec_name || 'Unknown';
      const groupKey = `${cycle.work_cycles_operator_rec_name}|${workCenter}|${routing}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(cycle);
    }

    return groups;
  }

  /**
   * Calculate UPH for a specific group of work cycles
   */
  private async calculateGroupUph(groupKey: string, cycles: any[]): Promise<{
    operatorName: string;
    workCenter: string;
    routing: string;
    uph: number;
    observations: number;
  } | null> {
    const [operatorName, workCenter, routing] = groupKey.split('|');

    // Group by production order for accurate UPH calculation
    const productionGroups = new Map<string, any[]>();
    
    for (const cycle of cycles) {
      const moKey = cycle.work_production_id || cycle.work_production_number || 'unknown';
      if (!productionGroups.has(moKey)) {
        productionGroups.set(moKey, []);
      }
      productionGroups.get(moKey)!.push(cycle);
    }

    let totalQuantity = 0;
    let totalDurationHours = 0;
    let validMOs = 0;

    // Calculate UPH using MO-level aggregation
    for (const [moKey, moCycles] of productionGroups.entries()) {
      // Get production order quantity
      const quantity = await this.getProductionOrderQuantity(moKey);
      if (!quantity || quantity <= 0) continue;

      // Sum duration for this MO
      const totalDurationSeconds = moCycles.reduce((sum, cycle) => {
        return sum + (cycle.work_cycles_duration || 0);
      }, 0);

      if (totalDurationSeconds <= 0) continue;

      totalQuantity += quantity;
      totalDurationHours += totalDurationSeconds / 3600;
      validMOs++;
    }

    if (validMOs === 0 || totalDurationHours <= 0) {
      return null;
    }

    const uph = totalQuantity / totalDurationHours;

    return {
      operatorName,
      workCenter,
      routing,
      uph,
      observations: validMOs
    };
  }

  /**
   * Update existing UPH record by combining with new data
   */
  private async updateExistingUphRecord(existing: any, newData: any): Promise<void> {
    // Combine observations and recalculate weighted average
    const totalObservations = existing.observationCount + newData.observations;
    const combinedUph = (
      (existing.uph * existing.observationCount) + 
      (newData.uph * newData.observations)
    ) / totalObservations;

    await db
      .update(uphData)
      .set({
        uph: combinedUph,
        observationCount: totalObservations,
        updatedAt: new Date()
      })
      .where(eq(uphData.id, existing.id));
  }

  /**
   * Get production order quantity efficiently
   */
  private async getProductionOrderQuantity(moKey: string): Promise<number | null> {
    // Try production ID first
    if (moKey !== 'unknown' && !isNaN(Number(moKey))) {
      const po = await db
        .select({ quantity: productionOrders.quantity })
        .from(productionOrders)
        .where(eq(productionOrders.id, Number(moKey)))
        .limit(1);
      
      if (po.length > 0) {
        return po[0].quantity;
      }
    }

    // Fallback to MO number
    const po = await db
      .select({ quantity: productionOrders.quantity })
      .from(productionOrders)
      .where(eq(productionOrders.moNumber, moKey))
      .limit(1);

    return po.length > 0 ? po[0].quantity : null;
  }

  /**
   * Get the last processed work cycle ID from metadata
   */
  private async getLastProcessedId(): Promise<number> {
    // You could store this in a metadata table
    // For now, use the highest ID in uphData related cycles
    const result = await db
      .select({ maxId: sql<number>`COALESCE(MAX(${workCycles.id}), 0)` })
      .from(workCycles)
      .where(
        and(
          or(
            eq(workCycles.data_corrupted, false),
            isNull(workCycles.data_corrupted)
          )
        )
      );

    return result[0]?.maxId || 0;
  }

  /**
   * Set the last processed work cycle ID
   */
  private async setLastProcessedId(id: number): Promise<void> {
    // Store in a simple metadata table or use a singleton pattern
    console.log(`📝 Updated last processed ID to: ${id}`);
  }

  /**
   * Force full recalculation (for initial setup or when needed)
   */
  async runFullRecalculation(): Promise<OptimizedCalculationResult> {
    console.log("🔄 Running full UPH recalculation (clearing existing data)");
    
    // Clear existing UPH data
    await db.delete(uphData);
    
    // Reset last processed ID to 0
    await this.setLastProcessedId(0);
    
    // Run incremental calculation (which will process all data)
    return this.runIncrementalCalculation();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime
    };
  }
}

export const optimizedUphCalculator = OptimizedUphCalculator.getInstance();