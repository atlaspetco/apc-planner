import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import { sql, eq } from "drizzle-orm";

/**
 * Fetches production quantities from Fulfil API and updates work cycles
 */
export async function fetchAndUpdateProductionQuantities() {
  const FULFIL_BASE_URL = "https://apc.fulfil.io";
  const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
  
  if (!FULFIL_ACCESS_TOKEN) {
    throw new Error("FULFIL_ACCESS_TOKEN not found");
  }

  console.log("=== FETCHING PRODUCTION QUANTITIES ===");
  
  // Get unique production IDs that need quantity updates
  const productionIds = await db
    .selectDistinct({ 
      productionId: workCycles.work_production_id,
      moNumber: workCycles.work_production_number 
    })
    .from(workCycles)
    .where(sql`${workCycles.work_production_id} IS NOT NULL AND ${workCycles.work_production_quantity} IS NULL`);
    
  console.log(`Found ${productionIds.length} unique production orders needing quantity updates`);
  
  let updated = 0;
  let errors = 0;
  
  // Process in batches to avoid overwhelming the API
  const batchSize = 50;
  for (let i = 0; i < productionIds.length; i += batchSize) {
    const batch = productionIds.slice(i, i + batchSize);
    const ids = batch.map(p => p.productionId).filter(id => id !== null);
    
    if (ids.length === 0) continue;
    
    try {
      console.log(`Fetching batch ${Math.floor(i/batchSize) + 1}: ${ids.length} production orders...`);
      
      // Use search_read to get production order quantities
      const response = await fetch(`${FULFIL_BASE_URL}/api/v2/model/production/search_read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": FULFIL_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          filters: [["id", "in", ids]],
          fields: ["id", "number", "quantity"],
          limit: batchSize
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Fulfil API error: ${response.status} - ${errorText}`);
        errors += ids.length;
        continue;
      }
      
      const productions = await response.json();
      console.log(`Received ${productions.length} production orders from API`);
      
      // Update work cycles with production quantities
      for (const prod of productions) {
        if (prod.quantity) {
          const result = await db
            .update(workCycles)
            .set({ work_production_quantity: prod.quantity })
            .where(eq(workCycles.work_production_id, prod.id));
            
          updated++;
          
          if (i < 5) {
            console.log(`Updated MO${prod.number} (ID: ${prod.id}) with quantity: ${prod.quantity}`);
          }
        }
      }
      
      // Add delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Error processing batch: ${error}`);
      errors += ids.length;
    }
  }
  
  // Verify the update
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)` })
    .from(workCycles)
    .where(sql`${workCycles.work_production_id} IS NOT NULL AND ${workCycles.work_production_quantity} IS NULL`);
    
  console.log(`\n=== PRODUCTION QUANTITY UPDATE SUMMARY ===`);
  console.log(`✅ Updated: ${updated} production orders`);
  console.log(`❌ Errors: ${errors} production orders`);
  console.log(`⏳ Remaining: ${remaining} work cycles still need quantity updates`);
  console.log(`==========================================\n`);
  
  return { updated, errors, remaining };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAndUpdateProductionQuantities()
    .then(result => {
      console.log("Production quantity update complete:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("Failed to update production quantities:", error);
      process.exit(1);
    });
}