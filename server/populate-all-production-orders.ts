import { db } from "./db.js";
import { productionOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

/**
 * Populates ALL production orders from Fulfil API without filters
 * This ensures we have the complete dataset, not just recent orders
 */
export async function populateAllProductionOrders() {
  console.log("🔄 Starting complete production order population from Fulfil API...");
  
  const FULFIL_API_KEY = process.env.FULFIL_ACCESS_TOKEN;
  const BASE_URL = "https://apc.fulfil.io";
  
  if (!FULFIL_API_KEY) {
    throw new Error("FULFIL_ACCESS_TOKEN not found");
  }

  try {
    // Use search_read to get ALL production orders without any filters
    const endpoint = `${BASE_URL}/api/v2/model/production.order/search_read`;
    
    console.log("📋 Fetching ALL production orders from Fulfil...");
    
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': FULFIL_API_KEY,
      },
      body: JSON.stringify({
        "filters": [], // No filters - get ALL production orders
        "fields": [
          'id', 'rec_name', 'state', 'quantity', 
          'product.code', 'product.name', 'product.rec_name',
          'routing.name', 'routing.rec_name',
          'planned_date', 'create_date'
        ],
        "limit": 10000 // High limit to get all orders
      }),
    });
    
    if (!response.ok) {
      console.error(`❌ Failed to fetch production orders: ${response.status} - ${await response.text()}`);
      return { success: false, error: `API error: ${response.status}` };
    }
    
    const orders = await response.json();
    console.log(`✅ Fetched ${orders.length} production orders from Fulfil`);
    
    // Clear existing production orders
    console.log("🗑️ Clearing existing production orders...");
    await db.delete(productionOrders);
    
    // Insert all orders with proper routing
    let insertedCount = 0;
    let skippedCount = 0;
    
    for (const order of orders) {
      try {
        // Extract routing name - prefer routing.name, fallback to routing.rec_name
        let routingName = '';
        if (order.routing) {
          if (typeof order.routing === 'object') {
            routingName = order.routing.name || order.routing.rec_name || '';
          } else if (typeof order.routing === 'string') {
            routingName = order.routing;
          }
        }
        
        // Extract product info
        const productCode = order['product.code'] || 
                          (order.product && order.product.code) || 
                          '';
        const productName = order['product.name'] || 
                          (order.product && order.product.name) || 
                          order['product.rec_name'] || 
                          (order.product && order.product.rec_name) ||
                          order.rec_name || 
                          '';
        
        // Parse dates
        let plannedDate = null;
        if (order.planned_date) {
          if (typeof order.planned_date === 'object' && order.planned_date.iso_string) {
            plannedDate = new Date(order.planned_date.iso_string);
          } else if (typeof order.planned_date === 'string') {
            plannedDate = new Date(order.planned_date);
          }
        }
        
        let createDate = null;
        if (order.create_date) {
          if (typeof order.create_date === 'object' && order.create_date.iso_string) {
            createDate = new Date(order.create_date.iso_string);
          } else if (typeof order.create_date === 'string') {
            createDate = new Date(order.create_date);
          }
        }
        
        // Insert production order
        await db.insert(productionOrders).values({
          moNumber: order.rec_name || `MO${order.id}`,
          productName: productName,
          quantity: order.quantity || 0,
          status: order.state || 'unknown',
          routing: routingName,
          dueDate: plannedDate,
          batchId: null,
          priority: 'Normal',
          fulfilId: order.id,
          createdAt: createDate || new Date(),
          
          // Additional fields with snake_case mapping
          rec_name: order.rec_name,
          state: order.state,
          planned_date: plannedDate ? plannedDate.toISOString() : null,
          create_date: createDate ? createDate.toISOString() : null,
          product_code: productCode
        });
        
        insertedCount++;
        
        if (insertedCount % 100 === 0) {
          console.log(`Progress: ${insertedCount} orders inserted...`);
        }
        
      } catch (error) {
        console.error(`Failed to insert ${order.rec_name}:`, error);
        skippedCount++;
      }
    }
    
    console.log(`✅ Successfully populated ${insertedCount} production orders`);
    console.log(`⚠️ Skipped ${skippedCount} orders due to errors`);
    
    // Log routing distribution
    const routingStats = await db.selectDistinct({ 
      routing: productionOrders.routing 
    }).from(productionOrders);
    
    console.log("\n📊 Routing Distribution:");
    for (const { routing } of routingStats) {
      const count = await db.select({ count: productionOrders.id })
        .from(productionOrders)
        .where(eq(productionOrders.routing, routing || ''));
      console.log(`  - ${routing || 'Unknown'}: ${count.length} orders`);
    }
    
    return { 
      success: true, 
      inserted: insertedCount, 
      skipped: skippedCount,
      total: orders.length 
    };
    
  } catch (error) {
    console.error("Error populating production orders:", error);
    return { success: false, error: error.message };
  }
}