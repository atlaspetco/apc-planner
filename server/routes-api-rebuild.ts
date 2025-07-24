// Add this route to server/routes.ts for API rebuild functionality

// API endpoint to rebuild corrupted work cycles data from Fulfil API
app.post("/api/work-cycles/rebuild-corrupted", async (req, res) => {
  try {
    console.log("🚀 Starting corrupted work cycles rebuild from API...");
    
    // Import rebuild functions
    const { getCorruptedCyclesList, batchFetchCyclesFromAPI, updateDatabaseWithAuthenticData } = 
      await import("./rebuild-corrupted-data-from-api.js");
    
    // Get corrupted cycles list
    const corruptedCycles = await getCorruptedCyclesList();
    
    if (corruptedCycles.length === 0) {
      return res.json({
        success: true,
        message: "No corrupted cycles found - data is already clean",
        rebuiltCount: 0
      });
    }
    
    // Extract unique cycle IDs
    const cycleIds = [...new Set(corruptedCycles.map(c => c.work_cycles_id))].filter(id => id);
    
    // Fetch authentic data from API (smaller batches for reliability)
    const cycleDataMap = await batchFetchCyclesFromAPI(cycleIds, 5);
    
    // Update database with authentic data
    const updatedCount = await updateDatabaseWithAuthenticData(cycleDataMap);
    
    console.log(`✅ Rebuilt ${updatedCount} work cycles with authentic API data`);
    
    res.json({
      success: true,
      message: `Successfully rebuilt ${updatedCount} corrupted work cycles with authentic API data`,
      corruptedFound: corruptedCycles.length,
      uniqueCycleIds: cycleIds.length,
      apiDataFetched: cycleDataMap.size,
      databaseUpdated: updatedCount
    });
    
  } catch (error) {
    console.error("❌ Error rebuilding corrupted data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to rebuild corrupted work cycles data",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// API endpoint to check corruption status
app.get("/api/work-cycles/corruption-status", async (req, res) => {
  try {
    const { sql } = await import("drizzle-orm");
    const { db } = await import("./db.js");
    
    const corruptionStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_cycles,
        COUNT(CASE WHEN data_corrupted = TRUE THEN 1 END) as corrupted_cycles,
        COUNT(CASE WHEN data_corrupted = FALSE OR data_corrupted IS NULL THEN 1 END) as clean_cycles,
        ROUND(AVG(work_cycles_duration), 2) as avg_duration_seconds
      FROM work_cycles 
      WHERE work_cycles_duration IS NOT NULL
    `);
    
    const stats = corruptionStats.rows[0];
    
    res.json({
      success: true,
      totalCycles: parseInt(stats.total_cycles),
      corruptedCycles: parseInt(stats.corrupted_cycles),
      cleanCycles: parseInt(stats.clean_cycles),
      averageDurationSeconds: parseFloat(stats.avg_duration_seconds),
      corruptionPercentage: Math.round((stats.corrupted_cycles / stats.total_cycles) * 100)
    });
    
  } catch (error) {
    console.error("❌ Error checking corruption status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check corruption status"
    });
  }
});