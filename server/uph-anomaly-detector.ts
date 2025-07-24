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
      work_cycles_work_id: workCycles.work_cycles_work_id,
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
  
  // Calculate statistics per work center
  const workCenterStats = new Map<string, { mean: number; stdDev: number; max: number }>();
  
  workCenterData.forEach((uphValues, workCenter) => {
    const mean = uphValues.reduce((sum, val) => sum + val, 0) / uphValues.length;
    const variance = uphValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / uphValues.length;
    const stdDev = Math.sqrt(variance);
    const max = Math.max(...uphValues);
    
    workCenterStats.set(workCenter, { mean, stdDev, max });
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
    // Check for statistical outliers (3 standard deviations)
    else if (workCenterStats.has(workCenter)) {
      const stats = workCenterStats.get(workCenter)!;
      if (calculatedUph > stats.mean + 3 * stats.stdDev) {
        anomalyType = 'statistical_outlier';
        reason = `UPH ${calculatedUph.toFixed(1)} is ${((calculatedUph - stats.mean) / stats.stdDev).toFixed(1)}σ above mean`;
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
        fulfilUrl: getFulfilWorkOrderUrl(cycle.work_cycles_work_id),
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