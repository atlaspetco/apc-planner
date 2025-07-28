import { optimizedUphCalculator } from "./uphOptimizedCalculator.js";

/**
 * Background UPH calculation scheduler
 * Runs UPH calculations in the background without blocking API calls
 */
export class UphScheduler {
  private static instance: UphScheduler;
  private intervalId: NodeJS.Timeout | null = null;
  private isEnabled = true;

  static getInstance(): UphScheduler {
    if (!UphScheduler.instance) {
      UphScheduler.instance = new UphScheduler();
    }
    return UphScheduler.instance;
  }

  /**
   * Start the background scheduler
   * Checks for new data every 5 minutes and calculates if needed
   */
  start(checkIntervalMinutes: number = 5): void {
    if (this.intervalId) {
      console.log("📅 UPH scheduler is already running");
      return;
    }

    console.log(`🚀 Starting UPH background scheduler (checking every ${checkIntervalMinutes} minutes)`);

    // Run initial calculation
    this.runIfNeeded();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      if (this.isEnabled) {
        this.runIfNeeded();
      }
    }, checkIntervalMinutes * 60 * 1000);
  }

  /**
   * Stop the background scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("⏹️ UPH scheduler stopped");
    }
  }

  /**
   * Enable/disable the scheduler
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`📅 UPH scheduler ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if calculation is needed and run if so
   */
  private async runIfNeeded(): Promise<void> {
    try {
      const calculator = optimizedUphCalculator;
      
      // Check if already running
      if (calculator.getStatus().isRunning) {
        console.log("⏳ UPH calculation already in progress, skipping");
        return;
      }

      // Check if recalculation is needed
      const needsRecalc = await calculator.needsRecalculation();
      
      if (needsRecalc) {
        console.log("🔄 New work cycles detected, starting incremental UPH calculation");
        const result = await calculator.runIncrementalCalculation();
        
        console.log(`✅ Background UPH calculation completed:`, {
          newCalculations: result.newCalculations,
          updatedCalculations: result.updatedCalculations,
          totalProcessed: result.totalProcessed,
          executionTimeMs: result.executionTimeMs
        });
      } else {
        console.log("✨ UPH data is up to date, no calculation needed");
      }

    } catch (error) {
      console.error("❌ Error in background UPH calculation:", error);
    }
  }

  /**
   * Manually trigger calculation
   */
  async triggerCalculation(force = false): Promise<void> {
    const calculator = optimizedUphCalculator;
    
    if (force) {
      console.log("🔧 Force triggering full UPH recalculation");
      await calculator.runFullRecalculation();
    } else {
      console.log("⚡ Triggering incremental UPH calculation");
      await calculator.runIncrementalCalculation();
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.intervalId !== null,
      isEnabled: this.isEnabled,
      calculatorStatus: optimizedUphCalculator.getStatus()
    };
  }
}

export const uphScheduler = UphScheduler.getInstance();