import axios from 'axios';

const BASE_URL = 'https://apc.fulfil.io/api/v2';

if (!process.env.FULFIL_ACCESS_TOKEN) {
  throw new Error('FULFIL_ACCESS_TOKEN environment variable is required');
}

const fulfil = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-API-KEY': process.env.FULFIL_ACCESS_TOKEN,
    'Content-Type': 'application/json',
  },
});

/**
 * Helper function for paginated fetch with proper error handling
 */
async function fetchAllPaginated(endpoint: string, body: any): Promise<any[]> {
  const allResults: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const response = await fulfil.post(endpoint, {
        ...body,
        offset,
        limit,
      });

      const chunk = response.data;
      if (!Array.isArray(chunk)) break;

      allResults.push(...chunk);
      if (chunk.length < limit) break;

      offset += limit;
    } catch (error) {
      console.error(`Error fetching ${endpoint} at offset ${offset}:`, error);
      break;
    }
  }

  return allResults;
}

/**
 * 1. Planning Grid - Active Work Orders
 */
export async function fetchActiveWorkOrders() {
  return fetchAllPaginated(
    "/model/work.order/search_read",
    {
      domain: [["state", "in", ["request", "draft", "waiting", "assigned", "running"]]],
      fields: ["id", "name", "production_id", "work_center_id", "qty_produced", "operator_id", "state"],
    }
  );
}

/**
 * 2. UPH Calculation - Done Work Cycles with filtered data
 */
export async function fetchDoneWorkCycles() {
  return fetchAllPaginated(
    "/model/production.work.cycle/search_read",
    {
      domain: [
        ["state", "=", "done"],
        ["duration", ">=", 30] // Filter out cycles shorter than 30 seconds
      ],
      fields: [
        "id", 
        "rec_name", 
        "duration", 
        "write_date", 
        "production_id", 
        "operator_id", 
        "work_center_id",
        "quantity_done"
      ],
    }
  );
}

/**
 * 3. Real MO Quantities - Done MOs
 */
export async function fetchDoneMOQuantities() {
  const data = await fetchAllPaginated(
    "/model/production.order/search_read",
    {
      domain: [["state", "=", "done"]],
      fields: ["id", "quantity", "work_order_ids"],
    }
  );

  return data.map((mo: any) => ({
    id: mo.id,
    quantity: mo.quantity,
    workOrderIds: mo.work_order_ids,
  }));
}

/**
 * Test connection to Fulfil API
 */
export async function testFulfilConnection(): Promise<boolean> {
  try {
    const response = await fulfil.get('/model/production.order', {
      params: { limit: 1 }
    });
    return response.status === 200;
  } catch (error) {
    console.error('Fulfil connection test failed:', error);
    return false;
  }
}

export { fetchAllPaginated };