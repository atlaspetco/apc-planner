import { db } from "./database.js";
import { productionOrders, workCycles } from "../shared/schema.js";
import { sql } from "drizzle-orm";

/**
 * Populates missing production orders from work cycles data
 * This fixes the issue where we have 1,898 MOs in work_cycles but only 73 in production_orders
 */
export async function populateMissingProductionOrders() {
  console.log("Starting to populate missing production orders...");
  
  try {
    // Get all unique MO numbers from work_cycles that don't exist in production_orders
    const missingMOs = await db.execute(sql`
      SELECT DISTINCT 
        wc.work_production_number as mo_number,
        MAX(wc.work_production_rec_name) as rec_name,
        MAX(wc.work_production_routing_rec_name) as routing,
        SUM(wc.work_cycles_quantity_done) as total_quantity,
        MIN(wc.work_production_create_date) as created_date,
        MAX(wc.work_production_create_date) as updated_date
      FROM work_cycles wc
      LEFT JOIN production_orders po ON po.mo_number = wc.work_production_number
      WHERE po.id IS NULL
        AND wc.work_production_number IS NOT NULL
      GROUP BY wc.work_production_number
    `);

    console.log(`Found ${missingMOs.length} missing production orders to populate`);

    // Insert missing production orders
    let inserted = 0;
    for (const mo of missingMOs) {
      if (!mo.mo_number || !mo.total_quantity) continue;
      
      try {
        await db.insert(productionOrders).values({
          moNumber: mo.mo_number,
          productName: mo.rec_name || mo.mo_number,
          quantity: Number(mo.total_quantity),
          status: 'done', // These are completed work cycles
          productRouting: mo.routing || 'Unknown',
          createdAt: mo.created_date || new Date(),
          updatedAt: mo.updated_date || new Date()
        });
        inserted++;
      } catch (err) {
        // Skip duplicates or errors
        console.error(`Error inserting ${mo.mo_number}:`, err);
      }
    }

    console.log(`Successfully populated ${inserted} missing production orders`);
    
    // Verify the results
    const totalPOs = await db.execute(sql`SELECT COUNT(*) as count FROM production_orders`);
    const totalMOs = await db.execute(sql`SELECT COUNT(DISTINCT work_production_number) as count FROM work_cycles`);
    
    console.log(`Total production orders: ${totalPOs[0].count}`);
    console.log(`Total unique MOs in work cycles: ${totalMOs[0].count}`);
    
    return {
      success: true,
      inserted,
      totalProductionOrders: totalPOs[0].count,
      totalWorkCycleMOs: totalMOs[0].count
    };
  } catch (error) {
    console.error("Error populating production orders:", error);
    throw error;
  }
}