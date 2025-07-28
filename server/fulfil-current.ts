/**
 * Fulfil API service to get current production orders (MO178xxx series)
 */

interface CurrentProductionOrder {
  id: string;
  rec_name: string;
  state: string;
  quantity: number;
  product_name?: string;          // Made optional as it's sometimes productName
  product_code: string;
  planned_date: string;
  workOrders?: WorkOrderInfo[];  // camelCase to match actual return value
  moNumber: string;               // Added missing property
  routing: string;                // Added missing property
  productName: string;            // Added missing property
  status: string;                 // Added missing property
  routingName: string;            // Added missing property
  dueDate: string;                // Added missing property
  fulfilId: string;               // Added missing property
}

interface WorkOrderInfo {
  id: string;
  work_center?: string;           // Made optional since it's mapped to workCenter
  workCenter?: string;            // Made optional as it might not always be present
  originalWorkCenter?: string;    // Added missing property
  operation: string;
  quantity_done?: number;         // Made optional
  quantity?: number;              // Added alternative property name
  state: string;
  employee_name?: string | null;  // Added missing property
  employee_id?: string | null;    // Added missing property
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
    console.log("=== getCurrentProductionOrders called ===");
    try {
      if (!this.apiKey) {
        console.log("No API key found, returning empty array");
        return [];
      }

      // Fetch work orders directly - they contain all the data we need
      const endpoint = `${this.baseUrl}/api/v2/model/production.work/search_read`;
      console.log(`Fetching work orders directly...`);
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          "filters": [
            ['state', 'in', ['request', 'draft', 'waiting', 'assigned', 'running']]
          ],
          "fields": [
            'id',
            'production',
            'production.rec_name',
            'production.state',
            'production.quantity',
            'production.planned_date',
            'production.product.rec_name',
            'production.product.code',
            'production.routing.rec_name',
            'rec_name',
            'work_center.rec_name',
            'operation.rec_name', 
            'quantity_done',
            'state'
          ]
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (response.status !== 200) {
        console.error(`Work order fetch failed with status ${response.status}`);
        const errorText = await response.text();
        console.error(`Error details: ${errorText}`);
        return [];
      }

      const workOrders = await response.json();
      if (!Array.isArray(workOrders)) {
        console.error("Unexpected response format:", workOrders);
        return [];
      }

      console.log(`Found ${workOrders.length} work orders`);
      
      // Group work orders by production order
      const productionOrdersMap = new Map<number, any>();
      
      for (const wo of workOrders) {
        const productionId = wo['production'];
        if (!productionId) continue;
        
        // Get or create production order entry
        if (!productionOrdersMap.has(productionId)) {
          productionOrdersMap.set(productionId, {
            id: productionId,
            moNumber: wo['production.rec_name'] || `MO${productionId}`,
            rec_name: wo['production.rec_name'] || `MO${productionId}`,
            state: wo['production.state'] || 'unknown',
            quantity: wo['production.quantity'] || 0,
            planned_date: wo['production.planned_date'],
            productName: wo['production.product.rec_name'] || 'Unknown Product',
            product_code: wo['production.product.code'] || '',
            routing: wo['production.routing.rec_name'] || 'Unknown',
            routingName: wo['production.routing.rec_name'] || 'Unknown',
            workOrders: []
          });
        }
        
        // Map work center names to our 3 categories
        const originalWorkCenter = wo['work_center.rec_name'] || 'Unknown';
        let mappedWorkCenter = originalWorkCenter;
        
        if (originalWorkCenter.includes('Sewing') || originalWorkCenter.includes('Rope')) {
          mappedWorkCenter = 'Assembly';
        } else if (originalWorkCenter.includes('Cutting')) {
          mappedWorkCenter = 'Cutting';
        } else if (originalWorkCenter.includes('Packaging')) {
          mappedWorkCenter = 'Packaging';
        }
        
        // Add work order to production order
        const productionOrder = productionOrdersMap.get(productionId);
        productionOrder.workOrders.push({
          id: wo.id.toString(),
          workCenter: mappedWorkCenter,
          originalWorkCenter: originalWorkCenter,
          operation: wo['operation.rec_name'] || 'Unknown',
          state: wo.state,
          quantity: wo.quantity_done || 0,
          employee_name: null,
          employee_id: null
        });
      }
      
      // Convert to production orders
      const productionOrders: CurrentProductionOrder[] = Array.from(productionOrdersMap.values()).map(po => ({
        id: po.id,
        moNumber: po.moNumber,
        productName: po.productName,
        quantity: po.quantity,
        status: po.state,
        state: po.state,
        routing: po.routing,
        routingName: po.routingName,
        dueDate: po.planned_date || new Date().toISOString(),
        fulfilId: po.id,
        rec_name: po.rec_name,
        planned_date: po.planned_date,
        product_code: po.product_code,
        workOrders: po.workOrders
      }));
      
      console.log(`Converted to ${productionOrders.length} production orders from work orders`);
      console.log(`Returning ${productionOrders.length} production orders`);
      console.log(`First few orders:`, productionOrders.slice(0, 3).map(po => ({
        id: po.id,
        moNumber: po.moNumber,
        workOrderCount: po.workOrders?.length || 0
      })));
      return productionOrders;

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