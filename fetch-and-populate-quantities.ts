import { db } from "./server/db";
import { workCycles } from "./shared/schema";
import { sql } from "drizzle-orm";
import fetch from 'node-fetch';

async function fetchAndPopulateQuantities() {
  try {
    const FULFIL_ACCESS_TOKEN = process.env.FULFIL_ACCESS_TOKEN;
    
    if (!FULFIL_ACCESS_TOKEN) {
      console.error('FULFIL_ACCESS_TOKEN not set');
      process.exit(1);
    }

    console.log("Fetching production quantities from Fulfil API...");
    
    // Get all unique production order IDs from work cycles
    const uniqueProductionIds = await db
      .selectDistinct({ 
        productionId: workCycles.work_production_id,
        moNumber: workCycles.work_production_number 
      })
      .from(workCycles)
      .where(sql`${workCycles.work_production_id} IS NOT NULL`);
    
    console.log(`Found ${uniqueProductionIds.length} unique production orders in work cycles`);
    
    // Batch fetch production order quantities from Fulfil
    const batchSize = 100;
    const quantityMap = new Map<string, number>();
    
    for (let i = 0; i < uniqueProductionIds.length; i += batchSize) {
      const batch = uniqueProductionIds.slice(i, i + batchSize);
      const productionIds = batch.map(p => p.productionId).filter(id => id !== null);
      
      if (productionIds.length === 0) continue;
      
      const url = 'https://apc.fulfil.io/api/v2/model/production.order/search_read';
      const body = {
        filters: [['id', 'in', productionIds]],
        fields: ['id', 'number', 'quantity'],
        limit: batchSize
      };
      
      console.log(`Fetching batch ${Math.floor(i / batchSize) + 1}...`);
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': FULFIL_ACCESS_TOKEN
        },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        console.error(`API Error (${response.status}):`, await response.text());
        continue;
      }
      
      const data = await response.json();
      
      // Map quantities by MO number
      data.forEach((mo: any) => {
        if (mo.number && mo.quantity) {
          quantityMap.set(mo.number, mo.quantity);
        }
      });
    }
    
    console.log(`Fetched quantities for ${quantityMap.size} production orders`);
    
    // Update work cycles with production quantities
    let updatedCount = 0;
    let totalUpdatedCycles = 0;
    
    for (const [moNumber, quantity] of quantityMap.entries()) {
      const result = await db
        .update(workCycles)
        .set({ work_production_quantity: quantity })
        .where(sql`${workCycles.work_production_number} = ${moNumber}`);
      
      updatedCount++;
      if (updatedCount % 100 === 0) {
        console.log(`Updated ${updatedCount} production orders...`);
      }
    }
    
    console.log(`\nSuccessfully updated ${updatedCount} production orders with quantities`);
    
    // Verify the update
    const verifyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(workCycles)
      .where(sql`${workCycles.work_production_quantity} IS NOT NULL`);
    
    console.log(`Verification: ${verifyCount[0].count} work cycles now have production quantities`);
    
    // Show sample of updated data
    const samples = await db
      .select({
        moNumber: workCycles.work_production_number,
        quantity: workCycles.work_production_quantity,
        operatorName: workCycles.work_cycles_operator_rec_name
      })
      .from(workCycles)
      .where(sql`${workCycles.work_production_quantity} IS NOT NULL`)
      .limit(5);
    
    console.log("\nSample updated records:");
    samples.forEach(s => {
      console.log(`  ${s.moNumber}: Quantity = ${s.quantity}, Operator = ${s.operatorName}`);
    });
    
  } catch (error) {
    console.error("Error fetching and populating quantities:", error);
  } finally {
    process.exit(0);
  }
}

fetchAndPopulateQuantities();