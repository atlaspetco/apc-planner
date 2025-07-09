/**
 * Fulfil API service to get current production orders (MO178xxx series)
 */

interface CurrentProductionOrder {
  id: string;
  rec_name: string;
  state: string;
  quantity: number;
  product_name: string;
  product_code: string;
  planned_date: string;
  work_orders?: WorkOrderInfo[];
}

interface WorkOrderInfo {
  id: string;
  work_center: string;
  operation: string;
  quantity_done: number;
  state: string;
}

export class FulfilCurrentService {
  private apiKey: string;
  private baseUrl = "https://apc.fulfil.io";
  private headers: Record<string, string>;

  constructor() {
    this.apiKey = process.env.FULFIL_ACCESS_TOKEN || "";
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-KEY': this.apiKey
    };
  }

  async getCurrentProductionOrders(): Promise<CurrentProductionOrder[]> {
    try {
      if (!this.apiKey) return [];

      // Step 1: Get ALL production orders using pagination
      let allOrders: any[] = [];
      let page = 1;
      let hasMore = true;
      
      // Use correct production schema (NOT production.order) with search_read
      const endpoint = `${this.baseUrl}/api/v2/model/production/search_read`;
      console.log(`Fetching production orders using correct production schema...`);
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          "filters": [
            ['state', '=', 'assigned']
          ],
          "fields": [
            'id', 'rec_name', 'number', 'state', 'quantity', 'quantity_done', 'quantity_remaining',
            'planned_date', 'priority', 'product.rec_name', 'product.code', 'product_code',
            'routing.rec_name', 'bom.rec_name'
          ]
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (response.status !== 200) {
        console.error(`Production schema fetch failed with status ${response.status}`);
        const errorText = await response.text();
        console.error(`Error details: ${errorText}`);
        return [];
      }

      allOrders = await response.json();
      if (!Array.isArray(allOrders)) {
        console.error("Unexpected response format:", allOrders);
        return [];
      }

      console.log(`Found total of ${allOrders.length} assigned production orders using production schema`);
      const orders = allOrders;
      
      // orders array is already populated from pagination above
      if (!Array.isArray(orders)) {
        console.error("Unexpected response format:", orders);
        return [];
      }
      
      // Step 2: Fetch work orders for all production orders  
      console.log("Fetching work orders for all production orders...");
      let allWorkOrders: any[] = [];
      
      try {
        const woEndpoint = `${this.baseUrl}/api/v2/model/production.work/search_read`;
        
        // Process ALL production orders now that individual calls work
        console.log(`Fetching work orders for all ${orders.length} production orders: ${orders.map(o => o.rec_name).join(', ')}`);
        
        for (const order of orders) {
          try {
            const woResponse = await fetch(woEndpoint, {
              method: 'PUT',
              headers: this.headers,
              body: JSON.stringify({
                "filters": [
                  ['production', '=', order.id]
                ],
                "fields": [
                  'id',
                  'production',
                  'rec_name',
                  'work_center.rec_name',
                  'operation.rec_name', 
                  'quantity_done',
                  'state'
                ]
              }),
              signal: AbortSignal.timeout(10000)
            });

            if (woResponse.status === 200) {
              const orderWorkOrders = await woResponse.json();
              allWorkOrders = allWorkOrders.concat(orderWorkOrders);
              console.log(`${order.rec_name}: Found ${orderWorkOrders.length} work orders`);
            } else {
              const errorText = await woResponse.text();
              console.log(`${order.rec_name} failed: ${woResponse.status} - ${errorText}`);
            }
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.log(`Error fetching work orders for ${order.rec_name}:`, error);
          }
        }

        console.log(`Successfully fetched ${allWorkOrders.length} work orders total from all production orders`);
        // Log sample work orders to verify
        if (allWorkOrders.length > 0) {
          console.log("Sample work orders:", allWorkOrders.slice(0, 3).map(wo => `${wo.rec_name} for production ${wo.production}`));
        }
      } catch (error) {
        console.log("Failed to fetch work orders:", error);
      }

      // Step 3: Group work orders by production order and create enriched data
      const productionOrdersMap = new Map();
      
      // Process production orders with authentic schema fields
      orders.forEach((po: any) => {
        const productName = po['product.rec_name'] || po.product?.rec_name || po.rec_name;
        const productCode = po['product.code'] || po.product_code || po.product?.code || `PROD-${po.id}`;
        const routingName = po['routing.rec_name'] || po.routing?.rec_name || 'Standard';
        const bomName = po['bom.rec_name'] || po.bom?.rec_name || routingName;
        
        productionOrdersMap.set(po.id, {
          id: po.id.toString(),
          rec_name: po.rec_name || po.number || `MO${po.id}`,
          state: po.state || 'assigned',
          quantity: po.quantity || 1,
          quantity_done: po.quantity_done || 0,
          quantity_remaining: po.quantity_remaining || po.quantity || 1,
          product_name: productName,
          product_code: productCode,
          routing_name: routingName,
          bom_name: bomName,
          priority: po.priority || 'Normal',
          planned_date: po.planned_date || new Date().toISOString().split('T')[0],
          work_orders: []
        });
      });
      
      // Then add work orders to their respective production orders
      allWorkOrders.forEach((wo: any) => {
        const productionId = wo.production;
        if (productionOrdersMap.has(productionId)) {
          // Map Fulfil work center names to expected frontend names
          const rawWorkCenter = wo['work_center.rec_name'] || 'Unknown';
          const rawOperation = wo['operation.rec_name'] || wo.rec_name || 'Unknown Operation';
          let mappedWorkCenter = 'Unknown';
          
          // Enhanced mapping logic based on both work center and operation
          if (rawWorkCenter.toLowerCase().includes('cutting') || 
              rawOperation.toLowerCase().includes('cutting') ||
              rawOperation.toLowerCase().includes('cut')) {
            mappedWorkCenter = 'Cutting';
          } else if (rawWorkCenter.toLowerCase().includes('sewing') || 
                    rawWorkCenter.toLowerCase().includes('assembly') ||
                    rawOperation.toLowerCase().includes('sewing') ||
                    rawOperation.toLowerCase().includes('assembly')) {
            mappedWorkCenter = 'Assembly';
          } else if (rawWorkCenter.toLowerCase().includes('packaging') ||
                    rawOperation.toLowerCase().includes('packaging') ||
                    rawOperation.toLowerCase().includes('grommet') ||
                    rawOperation.toLowerCase().includes('snap')) {
            mappedWorkCenter = 'Packaging';
          }
          
          // Debug logging for F3-SNAP products
          const po = productionOrdersMap.get(productionId);
          if (po && po.product_code && po.product_code.includes('F3-SNAP')) {
            console.log(`F3-SNAP Work Order Debug - ${po.rec_name}: WO${wo.id} | Work Center: "${rawWorkCenter}" -> "${mappedWorkCenter}" | Operation: "${rawOperation}"`);
          }
          
          productionOrdersMap.get(productionId).work_orders.push({
            id: wo.id.toString(),
            work_center: mappedWorkCenter,
            operation: rawOperation,
            quantity_done: wo.quantity_done || 0,
            state: wo.state || 'pending'
          });
        }
      });

      const enrichedOrders = Array.from(productionOrdersMap.values());
      
      // Log results
      enrichedOrders.forEach(po => {
        if (po.work_orders.length > 0) {
          console.log(`MO ${po.rec_name} (ID: ${po.id}) has ${po.work_orders.length} work orders`);
        }
      });

      console.log(`Returning ${enrichedOrders.length} production orders with work orders`);
      return enrichedOrders;

    } catch (error) {
      console.error("Error fetching current production orders:", error);
      return [];
    }
  }

  private async getProductDetails(productionId: number): Promise<{product_name: string} | null> {
    try {
      // Try using search_read to get detailed product info
      const endpoint = `${this.baseUrl}/api/v2/model/production.order/search_read`;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          "filters": [
            ['id', '=', productionId]
          ],
          "fields": [
            'product.rec_name',
            'product.name',
            'product.template.name'
          ]
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 200) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const productData = data[0];
          return {
            product_name: productData['product.rec_name'] || 
                         productData['product.name'] || 
                         productData['product.template.name'] || 
                         null
          };
        }
      }
    } catch (error) {
      console.log(`Failed to get product details for ${productionId}`);
    }
    return null;
  }

  private async getWorkOrdersForProduction(productionId: number): Promise<WorkOrderInfo[]> {
    try {
      // Use search_read to get work orders with detailed fields
      const endpoint = `${this.baseUrl}/api/v2/model/production.work/search_read`;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          "filters": [
            ['production', '=', productionId]
          ],
          "fields": [
            'id',
            'rec_name',
            'work_center.rec_name',
            'operation.rec_name', 
            'quantity_done',
            'state',
            'routing.name'
          ]
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 200) {
        const workOrders = await response.json();
        if (Array.isArray(workOrders)) {
          console.log(`Found ${workOrders.length} work orders for production ${productionId}:`, workOrders.map(wo => wo.rec_name));
          return workOrders.map((wo: any) => ({
            id: wo.id.toString(),
            work_center: wo['work_center.rec_name'] || wo.work_center?.rec_name || 'Unknown',
            operation: wo['operation.rec_name'] || wo.operation?.rec_name || wo.rec_name || 'Unknown Operation',
            quantity_done: wo.quantity_done || 0,
            state: wo.state || 'pending'
          }));
        }
      } else {
        const errorText = await response.text();
        console.log(`Work order search failed for production ${productionId}: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.log(`Failed to get work orders for production ${productionId}:`, error);
    }
    return [];
  }
}