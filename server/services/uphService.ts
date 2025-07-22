import { db } from '../db.js';

export const uphService = {
  async getUphTableData() {
    try {
      // Get UPH data from historical_uph table
      const result = await db.query(`
        SELECT 
          id,
          "operatorId",
          "operatorName",
          "workCenter",
          operation,
          routing,
          "productRouting",
          "unitsPerHour" as uph,
          observations as "observationCount",
          "totalDurationHours",
          "totalQuantity",
          "dataSource",
          "lastUpdated"
        FROM historical_uph
        ORDER BY "operatorName", "workCenter", routing
      `);
      
      return result.rows;
    } catch (error) {
      console.error('Error fetching UPH table data:', error);
      throw error;
    }
  }
};

// Export function needed by the UPH cron job
export async function calculateStandardizedUph() {
  try {
    console.log('UPH calculation job started at', new Date().toISOString());
    // Import the calculation service
    const { calculateFixedUph } = await import('./fixed-uph-calculation.js');
    
    // Run the calculation
    const result = await calculateFixedUph();
    console.log('UPH calculation completed:', result);
    
    return { success: true, result };
  } catch (error) {
    console.error('UPH calculation failed:', error);
    return { success: false, error: error.message };
  }
}