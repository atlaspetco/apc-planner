import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export interface AnomalyDetectionResult {
  moNumber: string;
  productionId: number;
  workCycleIds: string[];
  quantity: number;
  durationHrs: number;
  computedUPH: number;
  cohortMedianUPH: number;
  cohortSampleSize: number;
  productName: string;
  operatorName: string;
  workCenter: string;
}

export interface UphDataWithAnomalies {
  uphData: any[];
  anomalies: AnomalyDetectionResult[];
  filteredAverages: Record<string, number>;
}

/**
 * Detects statistical anomalies in UPH data using IQR method
 * Outliers are defined as: UPH > Q3 + 1.5 × IQR or UPH < Q1 - 1.5 × IQR
 * Falls back to z-score > 3 if sample size < 5
 */
export class AnomalyDetectionService {
  
  /**
   * Main anomaly detection function
   */
  async detectAnomalies(
    windowDays: number = 30,
    productName?: string,
    operatorId?: number
  ): Promise<UphDataWithAnomalies> {
    
    // Get raw UPH data grouped by MO
    const moLevelData = await this.getMoLevelUphData(windowDays, productName, operatorId);
    
    // Group data by cohort (product + work center + operator)
    const cohorts = this.groupByCohort(moLevelData);
    
    // Detect anomalies for each cohort
    const anomalies: AnomalyDetectionResult[] = [];
    const filteredAverages: Record<string, number> = {};
    
    for (const [cohortKey, cohortMos] of Object.entries(cohorts)) {
      const cohortAnomalies = this.detectCohortAnomalies(cohortKey, cohortMos);
      anomalies.push(...cohortAnomalies);
      
      // Calculate filtered average (excluding anomalies)
      const anomalyProductionIds = new Set(cohortAnomalies.map(a => a.productionId));
      const filteredMos = cohortMos.filter(mo => !anomalyProductionIds.has(mo.productionId));
      
      if (filteredMos.length > 0) {
        const filteredAvg = filteredMos.reduce((sum, mo) => sum + mo.uph, 0) / filteredMos.length;
        filteredAverages[cohortKey] = filteredAvg;
      }
    }
    
    // Get original UPH data for display
    const uphData = await this.getOriginalUphData(windowDays, productName, operatorId);
    
    return {
      uphData,
      anomalies,
      filteredAverages
    };
  }
  
  /**
   * Get MO-level UPH data from database
   */
  private async getMoLevelUphData(
    windowDays: number,
    productName?: string,
    operatorId?: number
  ) {
    let whereClause = sql`
      WHERE work_production_create_date >= NOW() - INTERVAL '${sql.raw(windowDays.toString())} days'
      AND work_cycles_operator_rec_name IS NOT NULL
      AND work_production_routing_rec_name IS NOT NULL
      AND work_cycles_work_center_rec_name IS NOT NULL
    `;
    
    if (productName) {
      whereClause = sql`${whereClause} AND work_production_routing_rec_name = ${productName}`;
    }
    
    if (operatorId) {
      // Need to map operatorId to operator name
      const operator = await db.execute(sql`SELECT name FROM operators WHERE id = ${operatorId}`);
      if (operator.rows.length > 0) {
        const operatorName = operator.rows[0].name;
        whereClause = sql`${whereClause} AND work_cycles_operator_rec_name = ${operatorName}`;
      }
    }
    
    const query = sql`
      SELECT 
        work_production_id as production_id,
        work_production_number as mo_number,
        work_cycles_operator_rec_name as operator_name,
        work_production_routing_rec_name as product_name,
        CASE 
          WHEN work_cycles_work_center_rec_name LIKE '%Assembly%' 
            OR work_cycles_work_center_rec_name LIKE '%Sewing%' 
            OR work_cycles_work_center_rec_name LIKE '%Rope%' 
          THEN 'Assembly'
          WHEN work_cycles_work_center_rec_name LIKE '%Cutting%' 
          THEN 'Cutting'
          WHEN work_cycles_work_center_rec_name LIKE '%Packaging%' 
          THEN 'Packaging'
          ELSE work_cycles_work_center_rec_name
        END as work_center,
        MAX(work_production_quantity) as quantity,
        SUM(work_cycles_duration) / 3600.0 as duration_hrs,
        STRING_AGG(DISTINCT work_cycles_id::text, ',') as work_cycle_ids,
        COUNT(*) as cycle_count
      FROM work_cycles 
      ${whereClause}
      GROUP BY 
        work_production_id,
        work_production_number,
        work_cycles_operator_rec_name,
        work_production_routing_rec_name,
        CASE 
          WHEN work_cycles_work_center_rec_name LIKE '%Assembly%' 
            OR work_cycles_work_center_rec_name LIKE '%Sewing%' 
            OR work_cycles_work_center_rec_name LIKE '%Rope%' 
          THEN 'Assembly'
          WHEN work_cycles_work_center_rec_name LIKE '%Cutting%' 
          THEN 'Cutting'
          WHEN work_cycles_work_center_rec_name LIKE '%Packaging%' 
          THEN 'Packaging'
          ELSE work_cycles_work_center_rec_name
        END
      HAVING SUM(work_cycles_duration) > 120 -- Minimum 2 minutes
    `;
    
    const result = await db.execute(query);
    
    return result.rows.map((row: any) => ({
      productionId: row.production_id,
      moNumber: row.mo_number,
      operatorName: row.operator_name,
      productName: row.product_name,
      workCenter: row.work_center,
      quantity: row.quantity,
      durationHrs: row.duration_hrs,
      workCycleIds: row.work_cycle_ids.split(','),
      cycleCount: row.cycle_count,
      uph: row.quantity / row.duration_hrs
    }));
  }
  
  /**
   * Group MO data by cohort (product + work center + operator)
   */
  private groupByCohort(moData: any[]): Record<string, any[]> {
    const cohorts: Record<string, any[]> = {};
    
    for (const mo of moData) {
      const cohortKey = `${mo.productName}|${mo.workCenter}|${mo.operatorName}`;
      if (!cohorts[cohortKey]) {
        cohorts[cohortKey] = [];
      }
      cohorts[cohortKey].push(mo);
    }
    
    return cohorts;
  }
  
  /**
   * Detect anomalies within a cohort using IQR method
   */
  private detectCohortAnomalies(cohortKey: string, cohortMos: any[]): AnomalyDetectionResult[] {
    if (cohortMos.length < 3) {
      return []; // Need at least 3 samples for meaningful anomaly detection
    }
    
    const uphValues = cohortMos.map(mo => mo.uph).sort((a, b) => a - b);
    const anomalies: AnomalyDetectionResult[] = [];
    
    // Use IQR method if we have enough samples, otherwise z-score
    if (uphValues.length >= 5) {
      const q1Index = Math.floor(uphValues.length * 0.25);
      const q3Index = Math.floor(uphValues.length * 0.75);
      const medianIndex = Math.floor(uphValues.length * 0.5);
      
      const q1 = uphValues[q1Index];
      const q3 = uphValues[q3Index];
      const median = uphValues[medianIndex];
      const iqr = q3 - q1;
      
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;
      
      for (const mo of cohortMos) {
        if (mo.uph < lowerBound || mo.uph > upperBound) {
          anomalies.push({
            moNumber: mo.moNumber,
            productionId: mo.productionId,
            workCycleIds: mo.workCycleIds,
            quantity: mo.quantity,
            durationHrs: mo.durationHrs,
            computedUPH: mo.uph,
            cohortMedianUPH: median,
            cohortSampleSize: cohortMos.length,
            productName: mo.productName,
            operatorName: mo.operatorName,
            workCenter: mo.workCenter
          });
        }
      }
    } else {
      // Use z-score method for small samples
      const mean = uphValues.reduce((sum, val) => sum + val, 0) / uphValues.length;
      const variance = uphValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / uphValues.length;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > 0) {
        for (const mo of cohortMos) {
          const zScore = Math.abs((mo.uph - mean) / stdDev);
          if (zScore > 3) {
            anomalies.push({
              moNumber: mo.moNumber,
              productionId: mo.productionId,
              workCycleIds: mo.workCycleIds,
              quantity: mo.quantity,
              durationHrs: mo.durationHrs,
              computedUPH: mo.uph,
              cohortMedianUPH: mean, // Use mean instead of median for z-score
              cohortSampleSize: cohortMos.length,
              productName: mo.productName,
              operatorName: mo.operatorName,
              workCenter: mo.workCenter
            });
          }
        }
      }
    }
    
    return anomalies;
  }
  
  /**
   * Get original UPH data for display (this should match existing UPH endpoint)
   */
  private async getOriginalUphData(
    windowDays: number,
    productName?: string,
    operatorId?: number
  ) {
    // This should call the existing UPH data service
    // For now, return placeholder - will integrate with existing service
    return [];
  }
  
  /**
   * Get comparator MOs for anomaly detail modal
   */
  async getComparatorMos(
    productName: string,
    quantity: number,
    operatorName: string,
    workCenter: string,
    windowDays: number = 30
  ) {
    const quantityRange = quantity * 0.2; // ±20% quantity
    const minQuantity = quantity - quantityRange;
    const maxQuantity = quantity + quantityRange;
    
    const query = sql`
      SELECT 
        work_production_id as production_id,
        work_production_number as mo_number,
        MAX(work_production_quantity) as quantity,
        SUM(work_cycles_duration) / 3600.0 as duration_hrs,
        STRING_AGG(DISTINCT work_cycles_id::text, ',') as work_cycle_ids
      FROM work_cycles 
      WHERE work_production_create_date >= NOW() - INTERVAL '${sql.raw(windowDays.toString())} days'
        AND work_production_routing_rec_name = ${productName}
        AND work_cycles_operator_rec_name = ${operatorName}
        AND CASE 
          WHEN work_cycles_work_center_rec_name LIKE '%Assembly%' 
            OR work_cycles_work_center_rec_name LIKE '%Sewing%' 
            OR work_cycles_work_center_rec_name LIKE '%Rope%' 
          THEN 'Assembly'
          WHEN work_cycles_work_center_rec_name LIKE '%Cutting%' 
          THEN 'Cutting'
          WHEN work_cycles_work_center_rec_name LIKE '%Packaging%' 
          THEN 'Packaging'
          ELSE work_cycles_work_center_rec_name
        END = ${workCenter}
        AND work_production_quantity BETWEEN ${minQuantity} AND ${maxQuantity}
      GROUP BY 
        work_production_id,
        work_production_number
      HAVING SUM(work_cycles_duration) > 120
      ORDER BY work_production_id DESC
      LIMIT 10
    `;
    
    const result = await db.execute(query);
    
    return result.rows.map((row: any) => ({
      productionId: row.production_id,
      moNumber: row.mo_number,
      quantity: row.quantity,
      durationHrs: row.duration_hrs,
      workCycleIds: row.work_cycle_ids.split(','),
      uph: row.quantity / row.duration_hrs
    }));
  }
}

export const anomalyDetectionService = new AnomalyDetectionService();