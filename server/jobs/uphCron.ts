/**
 * UPH Calculation Cron Job
 * Periodically calculates and caches UPH data for all combinations
 */

import { calculateCoreUph } from "../uph-core-calculator.js";
import { db } from "../db.js";
import { operators } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { getAllCategories } from "../utils/categoryMap.js";

// Store job state
let isRunning = false;
let lastRunTime: Date | null = null;
let lastRunResults: { success: boolean; message: string; calculations: number } | null = null;

/**
 * Run UPH calculation job
 * Calculates UPH for all active operators, products, and work centers
 * for all supported time windows (7, 30, 180 days)
 */
export async function runUphCalculationJob(): Promise<void> {
  if (isRunning) {
    console.log("UPH calculation job already running, skipping...");
    return;
  }
  
  isRunning = true;
  const startTime = new Date();
  console.log(`Starting UPH calculation job at ${startTime.toISOString()}`);
  
  try {
    // Get all operators (not just active ones - active status is only for auto-assign)
    const allOperators = await db
      .select()
      .from(operators);
    
    console.log(`Found ${allOperators.length} total operators`);
    
    // Get all work center categories
    const categories = getAllCategories();
    
    // Time windows to calculate
    const windows = [7, 30, 180];
    
    let totalCalculations = 0;
    const errors: string[] = [];
    
    // Pre-calculate all combinations to warm up cache
    for (const window of windows) {
      try {
        // Calculate global UPH for all products/operators/categories
        const globalResults = await calculateCoreUph({ 
          timeWindowDays: window,
          bypassDateFilter: false 
        });
        totalCalculations += globalResults.length;
        
        console.log(`Calculated ${globalResults.length} UPH entries for ${window}-day window`);
        
        // Core calculator handles all operators internally, no need for additional loops
      } catch (error) {
        const errorMsg = `Error calculating global UPH for window ${window}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;
    
    lastRunTime = endTime;
    lastRunResults = {
      success: errors.length === 0,
      message: errors.length === 0 
        ? `Successfully calculated ${totalCalculations} UPH entries in ${duration}s`
        : `Calculated ${totalCalculations} UPH entries with ${errors.length} errors in ${duration}s`,
      calculations: totalCalculations
    };
    
    console.log(lastRunResults.message);
    
  } catch (error) {
    console.error("Fatal error in UPH calculation job:", error);
    lastRunResults = {
      success: false,
      message: `Fatal error: ${error}`,
      calculations: 0
    };
  } finally {
    isRunning = false;
  }
}

/**
 * Get job status
 */
export function getJobStatus(): {
  isRunning: boolean;
  lastRunTime: Date | null;
  lastRunResults: any;
} {
  return {
    isRunning,
    lastRunTime,
    lastRunResults
  };
}

/**
 * Initialize cron job
 * Runs every 6 hours by default
 */
export function initializeUphCronJob(intervalHours: number = 6): void {
  // Run immediately on startup
  runUphCalculationJob();
  
  // Schedule periodic runs
  const intervalMs = intervalHours * 60 * 60 * 1000;
  setInterval(() => {
    runUphCalculationJob();
  }, intervalMs);
  
  console.log(`UPH calculation job scheduled to run every ${intervalHours} hours`);
}