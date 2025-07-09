interface FulfilSettings {
  apiKey: string;
  baseUrl: string;
  autoSync: boolean;
}

interface FulfilProductionOrder {
  id: number;
  rec_name: string;
  state: string;
  quantity: number;
  planned_date: string | { iso_string: string } | null;
  'product.code'?: string;
  'routing.name'?: string;
  product?: {
    code: string;
  };
  routing?: {
    name: string;
  };
}

interface FulfilWorkOrder {
  id: number;
  production: number;
  work_center?: number;
  operation?: number;
  rec_name: string;
  state: string;
  operator?: number;
  quantity_done?: number;
  planned_date?: string | { iso_string: string } | null;
  create_date?: { iso_string: string };
  priority?: string;
  type?: string;
  cost?: { decimal: string };
  'work_center.name'?: string;
  'operation.name'?: string;
  'operator.name'?: string;
}

interface FulfilWorkCycle {
  id: string;
  rec_name: string;
  state: string;
  duration: number;
  operator?: { rec_name: string };
  work_center?: { rec_name: string };
  production?: { id: number };
}

export class FulfilAPIService {
  private baseUrl: string;
  private apiKey: string | null = null;
  private headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  constructor(baseUrl = "https://apc.fulfil.io") {
    this.baseUrl = baseUrl;
    
    // Check for stored API key from environment
    const storedToken = process.env.FULFIL_ACCESS_TOKEN;
    console.log("Token found in environment:", storedToken ? "Yes" : "No");
    if (storedToken) {
      this.setApiKey(storedToken);
    }
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
    this.headers['X-API-KEY'] = this.apiKey;
  }

  async testConnection(): Promise<{ connected: boolean; message: string }> {
    try {
      if (!this.apiKey) {
        return { connected: false, message: "API key is required" };
      }

      console.log("Testing connection with headers:", { ...this.headers, 'X-API-KEY': '[REDACTED]' });
      
      // Test with simple GET endpoint as per working Python code
      const endpoint = `${this.baseUrl}/api/v2/model/production?per_page=1`;
      
      console.log("Testing endpoint:", endpoint);
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(10000)
      });

      const responseText = await response.text();
      console.log("Response details:", response.status, responseText);

      if (response.status === 200) {
        return { connected: true, message: "Successfully connected to Fulfil.io" };
      } else if (response.status === 401) {
        return { connected: false, message: "Invalid API key or insufficient permissions" };
      } else if (response.status === 405) {
        return { connected: false, message: "Method not allowed - verify API endpoints are correct" };
      } else if (response.status === 500) {
        return { connected: false, message: "Server error 500 - API key may be invalid or endpoint structure changed" };
      } else {
        return { connected: false, message: `Connection failed with status ${response.status}: ${responseText}` };
      }
    } catch (error) {
      console.error("Connection test failed:", error);
      return { connected: false, message: "Connection test failed - please check your network and API key" };
    }
  }

  async getManufacturingOrdersCount(stateFilter?: string): Promise<number> {
    try {
      if (!this.apiKey) return 0;

      const endpoint = `${this.baseUrl}/api/v2/model/production/count`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error counting MOs: ${response.status} - ${await response.text()}`);
        return 0;
      }

      const result = await response.json();
      return typeof result === 'number' ? result : (typeof result === 'object' && result.count ? result.count : 0);
    } catch (error) {
      console.error("Error counting manufacturing orders:", error);
      return 0;
    }
  }

  async getWorkOrdersCount(moId?: string): Promise<number> {
    try {
      if (!this.apiKey) return 0;

      const endpoint = `${this.baseUrl}/api/v2/model/production.work/count`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error counting WOs: ${response.status} - ${await response.text()}`);
        return 0;
      }

      const result = await response.json();
      return typeof result === 'number' ? result : (typeof result === 'object' && result.count ? result.count : 0);
    } catch (error) {
      console.error("Error counting work orders:", error);
      return 0;
    }
  }

  async getRecentManufacturingOrders(
    daysBack = 30, 
    limit = 500
  ): Promise<FulfilProductionOrder[]> {
    try {
      if (!this.apiKey) return [];

      // Calculate date filter for recent records
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      const dateFilter = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD format

      // Use POST search_read for proper filtering with date constraints
      const endpoint = `${this.baseUrl}/api/v2/model/production.order/search_read`;
      
      const requestBody = {
        fields: [
          'id', 'rec_name', 'state', 'quantity', 'product.code', 
          'routing.name', 'planned_date', 'create_date'
        ],
        filter: [
          ['create_date', '>=', dateFilter],
          '|',
          ['planned_date', '>=', dateFilter],
          '|', 
          ['state', 'in', ['draft', 'waiting', 'assigned', 'running']]
        ],
        limit: limit
      };

      console.log(`Fetching recent production orders since ${dateFilter}`);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching recent production orders: ${response.status} - ${await response.text()}`);
        return [];
      }

      const productionOrders = await response.json();
      console.log(`Fetched ${Array.isArray(productionOrders) ? productionOrders.length : 'unknown'} recent production orders`);
      
      if (!Array.isArray(productionOrders)) {
        console.error("Unexpected response format:", productionOrders);
        return [];
      }
      
      console.log("=== RECENT PRODUCTION ORDER SAMPLE ===");
      console.log(JSON.stringify(productionOrders?.[0], null, 2));
      console.log("=== END SAMPLE ===");

      // Transform to our expected format
      return productionOrders.map((po: any) => ({
        id: po.id,
        rec_name: po.rec_name || `MO${po.id}`,
        state: po.state || 'unknown',
        quantity: po.quantity || 0,
        planned_date: po.planned_date,
        product: po.product || {},
        routing: po.routing || {},
        create_date: po.create_date
      }));

    } catch (error) {
      console.error('Error fetching recent manufacturing orders:', error);
      return [];
    }
  }

  async getManufacturingOrders(
    stateFilter?: string, 
    limit = 500, 
    offset = 0
  ): Promise<FulfilProductionOrder[]> {
    // Use the new recent method instead of old approach
    return this.getRecentManufacturingOrders(30, limit);
  }

  async getActiveProductionOrdersWithWorkOrders(
    limit = 200, 
    offset = 0
  ): Promise<{ productionOrders: FulfilProductionOrder[], workOrders: FulfilWorkOrder[] }> {
    try {
      if (!this.apiKey) return { productionOrders: [], workOrders: [] };

      // Use production.work GET endpoint that works
      let endpoint = `${this.baseUrl}/api/v2/model/production.work`;
      
      const params = new URLSearchParams();
      params.append('per_page', limit.toString());
      if (offset > 0) {
        params.append('page', Math.floor(offset / limit + 1).toString());
      }

      endpoint += `?${params.toString()}`;

      console.log(`Fetching work orders and extracting production orders: ${endpoint}`);
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching work orders: ${response.status} - ${await response.text()}`);
        return { productionOrders: [], workOrders: [] };
      }

      const workOrders = await response.json();
      console.log(`Fetched ${Array.isArray(workOrders) ? workOrders.length : 'unknown'} work orders`);
      
      if (!Array.isArray(workOrders)) {
        console.error("Unexpected response format:", workOrders);
        return { productionOrders: [], workOrders: [] };
      }
      
      // Extract unique production orders and prepare work orders
      const productionOrdersMap = new Map();
      const processedWorkOrders: FulfilWorkOrder[] = [];
      
      for (const wo of workOrders) {
        // Parse production order ID from rec_name: "WO285 | Sewing - LH | MO5428"
        if (wo.rec_name && typeof wo.rec_name === 'string') {
          const parts = wo.rec_name.split(' | ');
          
          if (parts.length >= 3) {
            const moString = parts[2]; // e.g., "MO5428"
            const moMatch = moString.match(/MO(\d+)/);
            const operation = parts[1]; // e.g., "Sewing - LH"
            const workCenter = operation.split(' - ')[0]; // e.g., "Sewing"
            
            if (moMatch) {
              const prodId = parseInt(moMatch[1], 10); // Extract 5428 from "MO5428"
              
              if (prodId) {
                // Create production order if not exists
                if (!productionOrdersMap.has(prodId)) {
                  productionOrdersMap.set(prodId, {
                    id: prodId,
                    rec_name: `MO${prodId}`,
                    state: 'assigned', // Default state for active planning
                    quantity: 1, // Default quantity
                    planned_date: wo.planned_date || null,
                    routing: operation || 'Standard',
                    product: {
                      code: wo.product_code || `PROD-${prodId}`,
                      name: wo.product_name || `Product ${prodId}`
                    }
                  });
                }
                
                // Create work order for this production order
                processedWorkOrders.push({
                  id: wo.id,
                  production: prodId, // Link to production order
                  rec_name: wo.rec_name,
                  state: wo.state || 'assigned',
                  work_center: workCenter,
                  work_center_name: workCenter,
                  operation: operation,
                  operation_name: operation,
                  planned_date: wo.planned_date,
                  quantity_done: wo.quantity_done || 0,
                  routing: operation
                });
              }
            }
          }
        }
      }

      const uniqueProductionOrders = Array.from(productionOrdersMap.values());
      console.log(`Extracted ${uniqueProductionOrders.length} production orders and ${processedWorkOrders.length} work orders`);
      
      return { 
        productionOrders: uniqueProductionOrders, 
        workOrders: processedWorkOrders 
      };
    } catch (error) {
      console.error("Error fetching production orders with work orders:", error);
      return { productionOrders: [], workOrders: [] };
    }
  }

  async getCompletedWorkOrders(limit = 500, offset = 0): Promise<FulfilWorkOrder[]> {
    try {
      if (!this.apiKey) return [];

      const endpoint = `${this.baseUrl}/api/v2/model/production.work/search_read`;
      
      const requestBody = {
        filters: [
          ['state', '=', 'done']  // Only get completed work orders
        ],
        fields: [
          'id', 'production', 'work_center', 'operation', 'operator',  // ID fields
          'state', 'quantity_done', 'planned_date', 'rec_name',
          'create_date'  // Only essential fields
        ],
        limit: limit,
        offset: offset
      };

      console.log(`Fetching completed work orders from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        const errorText = await response.text();
        console.error(`Error fetching completed WOs: ${response.status} - ${errorText}`);
        return [];
      }

      const data = await response.json();
      console.log(`Retrieved ${data.length} completed work orders`);
      return data;
    } catch (error) {
      console.error("Error fetching completed work orders:", error);
      return [];
    }
  }

  async getWorkOrders(stateFilter?: string, limit = 500, offset = 0): Promise<FulfilWorkOrder[]> {
    try {
      if (!this.apiKey) return [];

      // Use search_read with PUT method to get complete fields
      const endpoint = `${this.baseUrl}/api/v2/model/production.work/search_read`;
      
      // Build filters for states
      let filters: any[] = [];
      if (stateFilter) {
        if (stateFilter === 'done') {
          filters = [['state', '=', 'done']];
        } else if (stateFilter === 'active') {
          filters = [['state', 'in', ['request', 'draft', 'waiting', 'assigned', 'running']]];
        } else {
          filters = [['state', '=', stateFilter]];
        }
      }

      const requestBody = {
        filters: filters,
        fields: [
          'id', 'rec_name', 'state', 'production', 'operation.name', 'work_center.name',
          'operator.name', 'quantity_done', 'planned_date', 'priority', 'type', 'cost',
          'create_date', 'write_date'
        ],
        limit: limit,
        offset: offset
      };

      console.log(`Fetching complete WO data from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching WOs: ${response.status} - ${await response.text()}`);
        return [];
      }

      const data = await response.json();
      console.log("Complete WO API Response sample:", JSON.stringify(data?.[0], null, 2));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching work orders:", error);
      return [];
    }
  }

  async getWorkCycles(options: { state?: string; limit?: number; offset?: number } = {}): Promise<FulfilWorkCycle[]> {
    try {
      if (!this.apiKey) return [];

      const { state = 'done', limit = 500, offset = 0 } = options;
      const endpoint = `${this.baseUrl}/api/v2/model/production.work.cycle/search_read`;
      
      // Get all work cycles - no filtering at all to capture recent data
      const filters: any[] = [];
      
      const requestBody = {
        filters: filters,
        fields: [
          'id', 'rec_name', 'state', 'duration', 'write_date'
        ],
        limit: limit,
        offset: offset,
        order: [['id', 'DESC']]  // Get most recent work cycles first
      };

      console.log(`Fetching work cycles from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        const errorText = await response.text();
        console.error(`Error fetching work cycles: ${response.status} - ${errorText}`);
        return [];
      }

      const data = await response.json();
      console.log(`Retrieved ${data.length} work cycles`);
      
      // Debug: Log first few cycles to see the structure
      if (data.length > 0) {
        console.log('Sample work cycle data:', JSON.stringify(data[0], null, 2));
        
        // Look for Evan Crosby specifically
        const evanCycles = data.filter(cycle => 
          cycle.rec_name && cycle.rec_name.includes('Evan Crosby')
        );
        console.log(`Found ${evanCycles.length} cycles for Evan Crosby`);
        if (evanCycles.length > 0) {
          console.log('Latest Evan cycle:', JSON.stringify(evanCycles[0], null, 2));
        }
      }
      
      // Transform the response to match our interface
      return data.map((cycle: any) => {
        // Parse duration from Fulfil's timedelta format
        let duration = 0;
        const durationField = cycle['work/cycles/duration'];
        if (durationField) {
          if (typeof durationField === 'number') {
            duration = durationField;
          } else if (typeof durationField === 'object' && durationField.seconds) {
            duration = durationField.seconds;
          } else if (typeof durationField === 'string') {
            duration = parseFloat(durationField);
          }
        }

        // Parse operator and work center from rec_name (e.g., "Assembly - Rope | Evan Crosby | Rope")
        const recParts = cycle.rec_name?.split(' | ') || [];
        const operationName = recParts[0] || '';
        const operatorName = recParts[1] || '';
        const workCenterName = recParts[2] || '';

        return {
          id: cycle.id?.toString(),
          rec_name: cycle.rec_name || `Cycle ${cycle.id}`,
          state: cycle.state || 'unknown',
          duration: duration,
          operator: operatorName ? { 
            rec_name: operatorName,
            write_date: cycle.write_date 
          } : undefined,
          work_center: workCenterName ? { 
            rec_name: workCenterName 
          } : undefined,
          production: { 
            id: 0, // Will be populated later if needed
            rec_name: `Production for ${operationName}`
          }
        };
      });
    } catch (error) {
      console.error("Error fetching work cycles:", error);
      return [];
    }
  }

  async getAllManufacturingOrders(stateFilter?: string, batchSize = 500): Promise<FulfilProductionOrder[]> {
    try {
      const allRecords: FulfilProductionOrder[] = [];
      let offset = 0;

      while (true) {
        const batch = await this.getManufacturingOrders(stateFilter, batchSize, offset);
        
        if (batch.length === 0) {
          break;
        }

        allRecords.push(...batch);
        
        if (batch.length < batchSize) {
          break;
        }

        offset += batchSize;
        console.log(`Fetched batch: offset ${offset - batchSize}, got ${batch.length} records`);
      }

      return allRecords;
    } catch (error) {
      console.error("Error in batch manufacturing orders fetch:", error);
      return [];
    }
  }

  async getAllWorkOrders(batchSize = 500): Promise<FulfilWorkOrder[]> {
    try {
      const allRecords: FulfilWorkOrder[] = [];
      let offset = 0;

      while (true) {
        const batch = await this.getWorkOrders(undefined, batchSize, offset);
        
        if (batch.length === 0) {
          break;
        }

        allRecords.push(...batch);
        
        if (batch.length < batchSize) {
          break;
        }

        offset += batchSize;
        console.log(`Fetched WO batch: offset ${offset - batchSize}, got ${batch.length} records`);
      }

      return allRecords;
    } catch (error) {
      console.error("Error in batch work orders fetch:", error);
      return [];
    }
  }

  async getWorkOrderDetails(workOrderId: number): Promise<FulfilWorkOrder | null> {
    try {
      if (!this.apiKey) return null;

      const endpoint = `${this.baseUrl}/api/v2/model/production.work/${workOrderId}`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(10000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching WO details: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching work order details:", error);
      return null;
    }
  }

  async getEmployeeDetails(employeeId: number): Promise<{ id: number; name: string; cost_per_hour?: number; active?: boolean } | null> {
    try {
      if (!this.apiKey) return null;

      const endpoint = `${this.baseUrl}/api/v2/model/company.employee/${employeeId}`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(10000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching employee details: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return {
        id: data.id,
        name: data.rec_name || data.name || `Employee ${data.id}`,
        cost_per_hour: data.cost_per_hour,
        active: data.active
      };
    } catch (error) {
      console.error("Error fetching employee details:", error);
      return null;
    }
  }

  // Convert Fulfil data to our internal format
  transformProductionOrder(fulfilMO: FulfilProductionOrder) {
    // Map Fulfil states to our internal states
    const stateMap: Record<string, string> = {
      'Draft': 'Draft',
      'Waiting': 'Waiting',
      'Assigned': 'Assigned',
      'Running': 'Running',
      'Done': 'Done'
    };

    // Handle null/undefined states by defaulting to Draft
    const status = fulfilMO.state ? (stateMap[fulfilMO.state] || fulfilMO.state) : 'Draft';

    // Handle Fulfil's complex date format
    let dueDate = undefined;
    if (fulfilMO.planned_date) {
      try {
        if (typeof fulfilMO.planned_date === 'object' && 'iso_string' in fulfilMO.planned_date) {
          // Fulfil returns date objects with iso_string property
          dueDate = new Date(fulfilMO.planned_date.iso_string);
        } else if (typeof fulfilMO.planned_date === 'string') {
          // Handle simple string dates
          dueDate = new Date(fulfilMO.planned_date);
        }
        
        // Validate the date
        if (dueDate && (isNaN(dueDate.getTime()) || dueDate.getFullYear() < 1900 || dueDate.getFullYear() > 3000)) {
          dueDate = undefined;
        }
      } catch (e) {
        console.warn(`Invalid date format for MO ${fulfilMO.id}:`, fulfilMO.planned_date);
        dueDate = undefined;
      }
    }

    // Extract routing name from Fulfil API response
    let routingName = null;
    if ((fulfilMO as any)['routing.name']) {
      routingName = (fulfilMO as any)['routing.name'];
    } else if (fulfilMO.routing && typeof fulfilMO.routing === 'object' && fulfilMO.routing.name) {
      routingName = fulfilMO.routing.name;
    }

    const transformed: any = {
      moNumber: fulfilMO.rec_name || `MO-${fulfilMO.id}`,
      productName: (fulfilMO as any)['product.code'] || 'Unknown Product', // Handle Fulfil's dot notation field names
      routing: routingName || 'Standard', // Map routing field from API
      quantity: fulfilMO.quantity || 0,
      status,
      priority: 'Medium',
      fulfilId: fulfilMO.id
    };

    // Only include dueDate if it's valid
    if (dueDate !== undefined) {
      transformed.dueDate = dueDate;
    }

    return transformed;
  }

  transformWorkOrder(fulfilWO: FulfilWorkOrder, productionOrderId: number) {
    const stateMap: Record<string, string> = {
      'Draft': 'Draft',
      'Waiting': 'Waiting',
      'Assigned': 'Assigned',
      'Running': 'Running',
      'Done': 'Done'
    };

    // Extract work center and operation from rec_name (e.g., "WO285 | Sewing - LH | MO5428")
    const parts = fulfilWO.rec_name.split(' | ');
    const workCenter = parts.length > 1 ? parts[1] : `WC-${fulfilWO.work_center || 'Unknown'}`;
    const operation = parts.length > 1 ? parts[1] : `OP-${fulfilWO.operation || 'Unknown'}`;

    return {
      productionOrderId,
      workCenter,
      operation,
      routing: 'Standard', // Default routing since field is not accessible
      status: stateMap[fulfilWO.state] || fulfilWO.state,
      assignedOperatorId: null,
      estimatedHours: 8,
      actualHours: null,
      sequence: 1,
      fulfilId: fulfilWO.id
    };
  }

  async getOperations(): Promise<any[]> {
    try {
      if (!this.apiKey) return [];

      // Use search_read to get complete operation data
      const endpoint = `${this.baseUrl}/api/v2/model/production.routing.operation/search_read`;
      
      const requestBody = {
        filters: [['active', '=', true]], // Only active operations
        fields: [
          'id', 'name', 'rec_name', 'work_center_category', 'active',
          'start_ahead', 'private_notes', 'public_notes', 'metadata'
        ],
        limit: 100,
        offset: 0
      };

      console.log(`Fetching operations from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching operations: ${response.status} - ${await response.text()}`);
        return [];
      }

      const data = await response.json();
      console.log("Operations API Response sample:", JSON.stringify(data?.[0], null, 2));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching operations:", error);
      return [];
    }
  }

  async getRoutings(): Promise<any[]> {
    try {
      if (!this.apiKey) return [];

      // Use search_read to get complete routing data
      const endpoint = `${this.baseUrl}/api/v2/model/production.routing/search_read`;
      
      const requestBody = {
        filters: [['active', '=', true]], // Only active routings
        fields: [
          'id', 'name', 'rec_name', 'active', 'steps',
          'private_notes', 'public_notes', 'metadata'
        ],
        limit: 100,
        offset: 0
      };

      console.log(`Fetching routings from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching routings: ${response.status} - ${await response.text()}`);
        return [];
      }

      const data = await response.json();
      console.log("Routings API Response sample:", JSON.stringify(data?.[0], null, 2));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching routings:", error);
      return [];
    }
  }

  async getWorkCenters(): Promise<any[]> {
    try {
      if (!this.apiKey) return [];

      // Use search_read to get complete work center data
      const endpoint = `${this.baseUrl}/api/v2/model/production.work.center/search_read`;
      
      const requestBody = {
        filters: [['active', '=', true]], // Only active work centers
        fields: [
          'id', 'name', 'rec_name', 'active', 'category',
          'cost_method', 'cost_price', 'private_notes', 'public_notes',
          'warehouse', 'parent', 'children', 'metadata'
        ],
        limit: 100,
        offset: 0
      };

      console.log(`Fetching work centers from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching work centers: ${response.status} - ${await response.text()}`);
        return [];
      }

      const data = await response.json();
      console.log("Work Centers API Response sample:", JSON.stringify(data?.[0], null, 2));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching work centers:", error);
      return [];
    }
  }

  async getProductionBatches(): Promise<any[]> {
    try {
      if (!this.apiKey) return [];

      // Use search_read to get complete production batch data
      const endpoint = `${this.baseUrl}/api/v2/model/production.batch/search_read`;
      
      const requestBody = {
        filters: [], // Get all batches, no state filter needed
        fields: [
          'id', 'name', 'number', 'rec_name', 'state', 'priority',
          'quantity', 'total_production_orders', 'productions',
          'private_notes', 'public_notes', 'metadata',
          'create_date', 'write_date'
        ],
        limit: 100,
        offset: 0
      };

      console.log(`Fetching production batches from: ${endpoint}`);
      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (response.status !== 200) {
        console.error(`Error fetching production batches: ${response.status} - ${await response.text()}`);
        return [];
      }

      const data = await response.json();
      console.log("Production Batches API Response sample:", JSON.stringify(data?.[0], null, 2));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching production batches:", error);
      return [];
    }
  }
}