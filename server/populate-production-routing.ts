import { db } from "./db.js";
import { productionOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

/**
 * Enriches production orders with authentic routing data from Fulfil API
 * This fixes the "Standard" routing issue by using real data
 */
export async function populateProductionRouting() {
  console.log("🔄 Starting production order routing enrichment from Fulfil API...");
  
  const FULFIL_API_KEY = process.env.FULFIL_ACCESS_TOKEN;
  const BASE_URL = "https://apc.fulfil.io/api/v2/model";
  
  if (!FULFIL_API_KEY) {
    throw new Error("FULFIL_ACCESS_TOKEN not found");
  }

  try {
    // Get all production orders from local database
    const localOrders = await db.select().from(productionOrders);
    console.log(`📋 Found ${localOrders.length} production orders to enrich with authentic routing data`);
    
    let enrichedCount = 0;
    let successCount = 0;
    
    // Process each production order to get routing information
    for (const order of localOrders) {
      if (!order.fulfilId) {
        console.log(`Skipping ${order.moNumber} - no Fulfil ID`);
        continue;
      }
      
      try {
        // Fetch specific production order details from Fulfil with expanded routing data
        console.log(`🔍 Fetching routing data for ${order.moNumber} (Fulfil ID: ${order.fulfilId})`);
        
        const response = await fetch(`${BASE_URL}/production.order/${order.fulfilId}?fields=id,rec_name,routing.name,routing.rec_name,product.code,product.name,quantity`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': FULFIL_API_KEY,
          },
        });
        
        if (!response.ok) {
          console.log(`❌ Failed to fetch ${order.moNumber}: ${response.status} - ${await response.text()}`);
          continue;
        }
        
        const orderData = await response.json();
        console.log(`📦 Raw Fulfil data for ${order.moNumber}:`, JSON.stringify(orderData, null, 2));
        
        // Extract routing information with detailed logging
        let routingName = 'Standard'; // fallback
        if (orderData.routing) {
          if (typeof orderData.routing === 'object' && orderData.routing.name) {
            routingName = orderData.routing.name;
            console.log(`✅ Found routing object name: ${routingName}`);
          } else if (typeof orderData.routing === 'object' && orderData.routing.rec_name) {
            routingName = orderData.routing.rec_name;
            console.log(`✅ Found routing rec_name: ${routingName}`);
          } else if (typeof orderData.routing === 'string') {
            routingName = orderData.routing;
            console.log(`✅ Found routing string: ${routingName}`);
          } else {
            console.log(`⚠️ Routing data exists but unrecognized format:`, orderData.routing);
          }
        } else {
          console.log(`⚠️ No routing data found for ${order.moNumber}, using fallback: ${routingName}`);
        }
        
        // Update production order with authentic routing data
        await db
          .update(productionOrders)
          .set({ 
            routing: routingName,  // Use 'routing' column, not 'routingName'
            productName: orderData.product?.code || orderData.product?.name || order.productName,
            quantity: orderData.quantity || order.quantity
          })
          .where(eq(productionOrders.id, order.id));
        
        console.log(`✅ Updated ${order.moNumber} with routing: ${routingName}`);
        enrichedCount++;
        successCount++;
        
        // Rate limiting - wait 200ms between requests to respect API limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.log(`Error enriching ${order.moNumber}:`, error);
        continue;
      }
    }
    
    console.log(`🎯 Enrichment complete: ${successCount}/${localOrders.length} orders successfully updated with authentic routing data`);
    return { 
      success: true, 
      enrichedCount: successCount, 
      totalOrders: localOrders.length,
      message: `Production order routing enrichment: ${successCount}/${localOrders.length} orders updated`
    };
    
  } catch (error) {
    console.error("Production routing enrichment failed:", error);
    throw error;
  }
}