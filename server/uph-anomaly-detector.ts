import { db } from "./db.js";
import { workCycles, uphData } from "../shared/schema.js";
import { sql, eq, and, gte, lte } from "drizzle-orm";

interface UphAnomaly {
  workCycleId: number;
  moNumber: string;
  operatorName: string;
  workCenter: string;
  routing: string;
  quantity: number;
  durationHours: number;
  calculatedUph: number;
  fulfilUrl: string;
  anomalyType: 'extreme_high' | 'extreme_low' | 'zero_duration' | 'statistical_outlier';
  reason: string;
}

// Generate Fulfil URL for a work order
function getFulfilWorkOrderUrl(workOrderId: number): string {
  // Fulfil URL pattern for production work orders
  return `https://apc.fulfil.io/client/#/model/production.work/${workOrderId}`;
}

// Detect anomalies in UPH calculations
export async function detectUphAnomalies(thresholdHigh: number = 500, thresholdLow: number = 1): Promise<UphAnomaly[]> {
  console.log("🔍 Starting UPH anomaly detection...");
  console.log(`Thresholds: High=${thresholdHigh}, Low=${thresholdLow}`);
  
  // Get all work cycles with calculated UPH
  const cycles = await db
    .select({
      work_cycles_id: workCycles.work_cycles_id,
      work_id: workCycles.work_id,
      work_production_number: workCycles.work_production_number,
      work_cycles_operator_rec_name: workCycles.work_cycles_operator_rec_name,
      work_cycles_work_center_rec_name: workCycles.work_cycles_work_center_rec_name,
      work_production_routing_rec_name: workCycles.work_production_routing_rec_name,
      work_production_quantity: workCycles.work_production_quantity,
      work_cycles_quantity_done: workCycles.work_cycles_quantity_done,
      work_cycles_duration: workCycles.work_cycles_duration,
    })
    .from(workCycles)
    .where(sql`${workCycles.work_cycles_duration} IS NOT NULL`);
    
  const anomalies: UphAnomaly[] = [];
  
  // Group by work center for statistical analysis
  const workCenterData = new Map<string, number[]>();
  
  cycles.forEach(cycle => {
    if (!cycle.work_cycles_duration) return;
    
    // Use work_cycles_quantity_done since work_production_quantity is NULL
    const quantity = cycle.work_cycles_quantity_done || cycle.work_production_quantity;
    if (!quantity) return;
    
    // Duration is in seconds, convert to hours
    const durationHours = cycle.work_cycles_duration / 3600;
    if (durationHours > 0) {
      const uph = quantity / durationHours;
      const wc = cycle.work_cycles_work_center_rec_name || 'Unknown';
      
      if (!workCenterData.has(wc)) {
        workCenterData.set(wc, []);
      }
      workCenterData.get(wc)!.push(uph);
    }
  });
  
  // PRD Section 4.5: Median + IQR per cohort (fallback z-score >3)
  const workCenterStats = new Map<string, { 
    median: number; 
    q1: number; 
    q3: number; 
    iqr: number; 
    lowerBound: number; 
    upperBound: number; 
    mean: number; 
    stdDev: number; 
    max: number 
  }>();
  
  workCenterData.forEach((uphValues, workCenter) => {
    // Sort values for percentile calculations
    const sortedValues = [...uphValues].sort((a, b) => a - b);
    const n = sortedValues.length;
    
    // Calculate median
    const median = n % 2 === 0 
      ? (sortedValues[n / 2 - 1] + sortedValues[n / 2]) / 2
      : sortedValues[Math.floor(n / 2)];
    
    // Calculate Q1 and Q3 (using standard method)
    const q1Index = Math.floor(n * 0.25);
    const q3Index = Math.floor(n * 0.75);
    const q1 = sortedValues[q1Index];
    const q3 = sortedValues[q3Index];
    const iqr = q3 - q1;
    
    // IQR-based outlier bounds (1.5 * IQR rule)
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    // Fallback statistics for z-score >3
    const mean = uphValues.reduce((sum, val) => sum + val, 0) / uphValues.length;
    const variance = uphValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / uphValues.length;
    const stdDev = Math.sqrt(variance);
    const max = Math.max(...uphValues);
    
    workCenterStats.set(workCenter, { 
      median, q1, q3, iqr, lowerBound, upperBound, mean, stdDev, max 
    });
    
    console.log(`📊 ${workCenter} cohort: Median=${median.toFixed(1)}, IQR=${iqr.toFixed(1)}, Bounds=[${lowerBound.toFixed(1)}, ${upperBound.toFixed(1)}], n=${n}`);
  });
  
  // Analyze each cycle for anomalies
  cycles.forEach(cycle => {
    if (!cycle.work_cycles_duration) return;
    
    // Use work_cycles_quantity_done since work_production_quantity is NULL
    const quantity = cycle.work_cycles_quantity_done || cycle.work_production_quantity;
    if (!quantity) return;
    
    // Duration is in seconds, convert to hours
    const durationHours = cycle.work_cycles_duration / 3600;
    const calculatedUph = quantity / durationHours;
    const workCenter = cycle.work_cycles_work_center_rec_name || 'Unknown';
    
    let anomalyType: UphAnomaly['anomalyType'] | null = null;
    let reason = '';
    
    // Check for zero or near-zero duration
    if (durationHours < 0.01) { // Less than 36 seconds
      anomalyType = 'zero_duration';
      reason = `Duration too short: ${(durationHours * 60).toFixed(1)} minutes`;
    }
    // Check for extreme high UPH
    else if (calculatedUph > thresholdHigh) {
      anomalyType = 'extreme_high';
      reason = `UPH ${calculatedUph.toFixed(1)} exceeds threshold of ${thresholdHigh}`;
    }
    // Check for extreme low UPH
    else if (calculatedUph < thresholdLow) {
      anomalyType = 'extreme_low';
      reason = `UPH ${calculatedUph.toFixed(1)} below threshold of ${thresholdLow}`;
    }
    // PRD Section 4.5: Check for IQR-based outliers with z-score fallback
    else if (workCenterStats.has(workCenter)) {
      const stats = workCenterStats.get(workCenter)!;
      
      // Primary detection: IQR-based outliers (1.5 * IQR rule)
      if (calculatedUph < stats.lowerBound || calculatedUph > stats.upperBound) {
        anomalyType = 'statistical_outlier';
        reason = `IQR outlier: UPH ${calculatedUph.toFixed(1)} outside [${stats.lowerBound.toFixed(1)}, ${stats.upperBound.toFixed(1)}]`;
      }
      // Fallback detection: z-score >3 for extreme cases
      else if (stats.stdDev > 0) {
        const zScore = Math.abs(calculatedUph - stats.mean) / stats.stdDev;
        if (zScore > 3) {
          anomalyType = 'statistical_outlier';
          reason = `Z-score outlier: UPH ${calculatedUph.toFixed(1)} (z-score: ${zScore.toFixed(2)})`;
        }
      }
    }
    
    if (anomalyType) {
      anomalies.push({
        workCycleId: cycle.work_cycles_id,
        moNumber: cycle.work_production_number || 'Unknown',
        operatorName: cycle.work_cycles_operator_rec_name || 'Unknown',
        workCenter: workCenter,
        routing: cycle.work_production_routing_rec_name || 'Unknown',
        quantity: quantity,
        durationHours: durationHours,
        calculatedUph: calculatedUph,
        fulfilUrl: getFulfilWorkOrderUrl(cycle.work_id || 0),
        anomalyType: anomalyType,
        reason: reason
      });
    }
  });
  
  // Debug: Check for any extremely high UPH values
  const extremeUph = cycles.filter(cycle => {
    const quantity = cycle.work_cycles_quantity_done || cycle.work_production_quantity;
    if (!quantity || !cycle.work_cycles_duration) return false;
    const uph = quantity / (cycle.work_cycles_duration / 3600);
    return uph > 10000;
  });
  
  console.log(`🚨 Found ${anomalies.length} anomalies out of ${cycles.length} work cycles`);
  console.log(`📊 Found ${extremeUph.length} cycles with UPH > 10,000`);
  
  // Sort by UPH descending to show worst anomalies first
  anomalies.sort((a, b) => b.calculatedUph - a.calculatedUph);
  
  return anomalies;
}

// Mark anomalies in the database (add flag, don't delete)
export async function flagAnomaliesInDatabase(anomalyIds: number[]): Promise<void> {
  // Add a field to track anomalies without deleting data
  // This preserves data integrity while allowing filtering
  console.log(`🏴 Flagging ${anomalyIds.length} work cycles as anomalies`);
  
  // Update work cycles with anomaly flag
  // Note: We'd need to add an 'is_anomaly' field to the schema
  // For now, we'll just track them in memory/separate table
}

// Get anomaly statistics
export async function getAnomalyStatistics() {
  const anomalies = await detectUphAnomalies();
  
  const byType = anomalies.reduce((acc, anomaly) => {
    acc[anomaly.anomalyType] = (acc[anomaly.anomalyType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const byWorkCenter = anomalies.reduce((acc, anomaly) => {
    acc[anomaly.workCenter] = (acc[anomaly.workCenter] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const byOperator = anomalies.reduce((acc, anomaly) => {
    acc[anomaly.operatorName] = (acc[anomaly.operatorName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    totalAnomalies: anomalies.length,
    byType,
    byWorkCenter,
    byOperator,
    topAnomalies: anomalies.slice(0, 10)
  };
}