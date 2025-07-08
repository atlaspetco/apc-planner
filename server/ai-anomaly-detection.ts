import OpenAI from "openai";
import { db } from "./db.js";
import { uphCalculationData } from "@shared/schema.js";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface WorkCycleAnomaly {
  id: number;
  operatorName: string;
  workCenter: string;
  routing: string;
  totalQuantity: number;
  totalHours: number;
  calculatedUph: number;
  observations: number;
  anomalyReason: string;
  severity: 'low' | 'medium' | 'high';
  shouldExclude: boolean;
}

interface AnomalyDetectionResult {
  totalRecords: number;
  anomaliesDetected: number;
  cleanRecords: number;
  anomalies: WorkCycleAnomaly[];
  summary: string;
}

/**
 * Analyze work cycle data for anomalies using OpenAI
 */
export async function detectWorkCycleAnomalies(): Promise<AnomalyDetectionResult> {
  try {
    console.log("Starting AI-powered anomaly detection on work cycle data...");
    
    // Get all aggregated work cycle data
    const workCycleData = await db.select().from(uphCalculationData);
    
    if (workCycleData.length === 0) {
      return {
        totalRecords: 0,
        anomaliesDetected: 0,
        cleanRecords: 0,
        anomalies: [],
        summary: "No work cycle data available for analysis"
      };
    }
    
    console.log(`Analyzing ${workCycleData.length} work cycle records for anomalies...`);
    
    // Transform data for AI analysis
    const analysisData = workCycleData.map(record => ({
      id: record.id,
      operator: record.operatorName,
      workCenter: record.workCenter,
      routing: record.routing,
      quantity: record.totalQuantityDone,
      durationSeconds: record.totalDurationSeconds,
      hours: Math.round((record.totalDurationSeconds / 3600) * 100) / 100,
      uph: Math.round((record.totalQuantityDone / (record.totalDurationSeconds / 3600)) * 100) / 100,
      observations: record.cycleCount
    })).filter(record => record.quantity > 0 && record.durationSeconds > 0);
    
    // Calculate basic statistics for context
    const uphValues = analysisData.map(r => r.uph).filter(u => u > 0 && u < 1000);
    const avgUph = uphValues.reduce((sum, uph) => sum + uph, 0) / uphValues.length;
    const minUph = Math.min(...uphValues);
    const maxUph = Math.max(...uphValues);
    
    // Group by work center for context
    const workCenterStats = new Map<string, { uphValues: number[], avgUph: number }>();
    analysisData.forEach(record => {
      if (!workCenterStats.has(record.workCenter)) {
        workCenterStats.set(record.workCenter, { uphValues: [], avgUph: 0 });
      }
      if (record.uph > 0 && record.uph < 1000) {
        workCenterStats.get(record.workCenter)!.uphValues.push(record.uph);
      }
    });
    
    workCenterStats.forEach((stats, workCenter) => {
      stats.avgUph = stats.uphValues.reduce((sum, uph) => sum + uph, 0) / stats.uphValues.length;
    });
    
    // Prepare prompt for OpenAI
    const prompt = `You are an expert manufacturing data analyst specializing in production efficiency and anomaly detection. Analyze this work cycle data for anomalies that would skew UPH (Units Per Hour) calculations.

MANUFACTURING CONTEXT:
- Assembly work typically: 8-15 UPH 
- Cutting work typically: 15-30 UPH
- Packaging work typically: 20-40 UPH
- Normal work cycles: 5 minutes to 2 hours
- Valid observations: 1-500 per operator/routing

DATASET OVERVIEW:
- Total records: ${analysisData.length}
- Overall UPH range: ${minUph.toFixed(1)} - ${maxUph.toFixed(1)} 
- Average UPH: ${avgUph.toFixed(1)}
- Work centers: ${Array.from(workCenterStats.keys()).join(", ")}

WORK CENTER AVERAGES:
${Array.from(workCenterStats.entries()).map(([wc, stats]) => `${wc}: ${stats.avgUph.toFixed(1)} UPH`).join('\n')}

SAMPLE DATA (showing first 20 records):
${analysisData.slice(0, 20).map(r => 
  `ID:${r.id} | ${r.operator} | ${r.workCenter} | ${r.routing} | ${r.quantity} units in ${r.hours}h = ${r.uph} UPH (${r.observations} obs)`
).join('\n')}

Identify anomalies that indicate:
1. Setup/downtime periods (very long duration, low quantity)
2. Data entry errors (impossible UPH rates)
3. Incomplete cycles (very short duration, high quantity)
4. Training/learning periods (unusually low efficiency)
5. Machine issues or quality problems

Respond with JSON format:
{
  "anomalies": [
    {
      "id": number,
      "reason": "specific explanation",
      "severity": "low|medium|high", 
      "shouldExclude": boolean,
      "expectedUphRange": "X-Y UPH"
    }
  ],
  "summary": "Brief analysis of patterns found"
}`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert manufacturing data analyst. Provide detailed anomaly detection in the exact JSON format requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1 // Low temperature for consistent analysis
    });

    const aiResult = JSON.parse(response.choices[0].message.content || '{"anomalies": [], "summary": "Analysis failed"}');
    
    // Process AI results and map back to our data
    const detectedAnomalies: WorkCycleAnomaly[] = [];
    
    if (aiResult.anomalies && Array.isArray(aiResult.anomalies)) {
      for (const anomaly of aiResult.anomalies) {
        const record = analysisData.find(r => r.id === anomaly.id);
        if (record) {
          detectedAnomalies.push({
            id: record.id,
            operatorName: record.operator,
            workCenter: record.workCenter,
            routing: record.routing,
            totalQuantity: record.quantity,
            totalHours: record.hours,
            calculatedUph: record.uph,
            observations: record.observations,
            anomalyReason: anomaly.reason,
            severity: anomaly.severity,
            shouldExclude: anomaly.shouldExclude
          });
        }
      }
    }
    
    const result: AnomalyDetectionResult = {
      totalRecords: analysisData.length,
      anomaliesDetected: detectedAnomalies.length,
      cleanRecords: analysisData.length - detectedAnomalies.filter(a => a.shouldExclude).length,
      anomalies: detectedAnomalies,
      summary: aiResult.summary || "AI analysis completed"
    };
    
    console.log(`AI anomaly detection completed: ${result.anomaliesDetected} anomalies found out of ${result.totalRecords} records`);
    
    return result;
    
  } catch (error) {
    console.error("Error in AI anomaly detection:", error);
    throw new Error(`Anomaly detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Calculate UPH with AI-filtered clean data
 */
export async function calculateCleanUph(): Promise<{
  success: boolean;
  calculations: Array<{
    operator: string;
    workCenter: string;
    routing: string;
    operation: string;
    totalQuantity: number;
    totalHours: number;
    unitsPerHour: number;
    observations: number;
    anomaliesExcluded: number;
  }>;
  anomalyReport: AnomalyDetectionResult;
  message: string;
}> {
  try {
    // First, detect anomalies
    const anomalyResult = await detectWorkCycleAnomalies();
    
    // Get clean data (excluding high-severity anomalies)
    const excludedIds = new Set(
      anomalyResult.anomalies
        .filter(a => a.shouldExclude && (a.severity === 'high' || a.severity === 'medium'))
        .map(a => a.id)
    );
    
    console.log(`Excluding ${excludedIds.size} anomalous records from UPH calculations`);
    
    // Calculate UPH using only clean data
    const allData = await db.select().from(uphCalculationData);
    const cleanData = allData.filter(record => !excludedIds.has(record.id));
    
    // Group clean data by operator + work center + routing
    const uphGroups = new Map<string, {
      operator: string;
      workCenter: string;
      routing: string;
      totalQuantity: number;
      totalDurationSeconds: number;
      totalObservations: number;
      anomaliesExcluded: number;
    }>();
    
    cleanData.forEach(record => {
      const key = `${record.operatorName}-${record.workCenter}-${record.routing}`;
      
      if (!uphGroups.has(key)) {
        uphGroups.set(key, {
          operator: record.operatorName || '',
          workCenter: record.workCenter,
          routing: record.routing,
          totalQuantity: 0,
          totalDurationSeconds: 0,
          totalObservations: 0,
          anomaliesExcluded: 0
        });
      }
      
      const group = uphGroups.get(key)!;
      if ((record.totalQuantityDone || 0) > 0) {
        group.totalQuantity += record.totalQuantityDone || 0;
        group.totalDurationSeconds += record.totalDurationSeconds;
        group.totalObservations += record.cycleCount;
      }
    });
    
    // Count anomalies per group
    anomalyResult.anomalies.forEach(anomaly => {
      const key = `${anomaly.operatorName}-${anomaly.workCenter}-${anomaly.routing}`;
      const group = uphGroups.get(key);
      if (group && anomaly.shouldExclude) {
        group.anomaliesExcluded++;
      }
    });
    
    // Calculate final UPH values
    const calculations = Array.from(uphGroups.values())
      .filter(group => group.totalQuantity > 0 && group.totalDurationSeconds > 0)
      .map(group => {
        const totalHours = group.totalDurationSeconds / 3600;
        const unitsPerHour = group.totalQuantity / totalHours;
        
        return {
          operator: group.operator,
          workCenter: group.workCenter,
          routing: group.routing,
          operation: 'Combined',
          totalQuantity: group.totalQuantity,
          totalHours: Math.round(totalHours * 100) / 100,
          unitsPerHour: Math.round(unitsPerHour * 100) / 100,
          observations: group.totalObservations,
          anomaliesExcluded: group.anomaliesExcluded
        };
      })
      .filter(calc => calc.unitsPerHour > 0 && calc.unitsPerHour < 500);
    
    return {
      success: true,
      calculations,
      anomalyReport: anomalyResult,
      message: `AI-filtered UPH calculations: ${calculations.length} clean combinations, ${excludedIds.size} anomalies excluded`
    };
    
  } catch (error) {
    console.error("Error in clean UPH calculation:", error);
    return {
      success: false,
      calculations: [],
      anomalyReport: {
        totalRecords: 0,
        anomaliesDetected: 0,
        cleanRecords: 0,
        anomalies: [],
        summary: "Error occurred during analysis"
      },
      message: `Clean UPH calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}