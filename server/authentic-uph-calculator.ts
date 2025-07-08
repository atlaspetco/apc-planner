/**
 * Authentic UPH calculation using production schema approach
 * 1. Get WOs by state=done with production IDs, work cycles, operator, operation, work center  
 * 2. Use Production order ID to call production order by ID, get routing and total MO quantity
 * 3. Sum cycle durations, convert to hours, calculate UPH by Routing + Operation
 */

interface ProductionOrderDetail {
  id: number;
  routing: {
    name: string;
  };
  quantity: number;
}

interface AuthenticUphResult {
  routing: string;
  workCenters: Record<string, {
    unitsPerHour: number;
    totalQuantity: number;
    totalHours: number;
    observations: number;
    operators: string[];
    operations: string[];
  }>;
  totalMoQuantity: number;
  totalWorkOrders: number;
}

/**
 * Calculate authentic UPH using database parity - no API calls needed
 */
export async function calculateAuthenticUph(): Promise<AuthenticUphResult[]> {
  const { workOrders, productionOrders } = await import("../shared/schema.js");
  const { db } = await import("./db.js");
  const { sql, isNotNull, and, gt, eq } = await import("drizzle-orm");

  console.log("Starting authentic UPH calculation using database parity...");

  // Step 1: Get completed work orders with production order routing information
  const completedWorkOrdersWithRouting = await db
    .select({
      id: workOrders.id,
      workCenter: workOrders.workCenter,
      workCenterName: workOrders.workCenterName,
      operation: workOrders.operation,
      operationName: workOrders.operationName,
      operatorName: workOrders.operatorName,
      totalCycleDuration: workOrders.totalCycleDuration,
      actualHours: workOrders.actualHours,
      quantityDone: workOrders.quantityDone,
      routing: workOrders.routing,
      // Production order details
      moQuantity: productionOrders.quantity,
      moRouting: productionOrders.routing,
    })
    .from(workOrders)
    .leftJoin(productionOrders, eq(workOrders.productionOrderId, productionOrders.id))
    .where(
      and(
        // Check for completion in either field
        sql`(${workOrders.state} = 'done' OR ${workOrders.status} = 'Completed')`,
        // Must have time data
        sql`(${workOrders.totalCycleDuration} IS NOT NULL AND ${workOrders.totalCycleDuration} > 0) OR (${workOrders.actualHours} IS NOT NULL AND ${workOrders.actualHours} > 0)`,
        // Must have routing information
        sql`(${workOrders.routing} IS NOT NULL OR ${productionOrders.routing} IS NOT NULL)`
      )
    );

  if (completedWorkOrdersWithRouting.length === 0) {
    console.log("No completed work orders with routing data found");
    return [];
  }

  // Step 2: Group by routing with work centers as sub-data
  const routingGroups = new Map<string, {
    routing: string;
    workCenters: Map<string, {
      totalMoQuantity: number;
      totalCycleDurationSeconds: number;
      observations: number;
      workOrderIds: Set<number>;
      operators: Set<string>;
      operations: Set<string>;
    }>;
    totalMoQuantity: number;
    totalWorkOrders: number;
  }>();

  for (const wo of completedWorkOrdersWithRouting) {
    // Use routing from work order first, then production order, then default
    const routing = wo.routing || wo.moRouting || 'Standard';
    const workCenter = wo.workCenterName || wo.workCenter || 'Unknown Work Center';
    const operation = wo.operationName || wo.operation || 'Unknown Operation';
    const operatorName = wo.operatorName || 'Unknown Operator';
    const moQuantity = wo.moQuantity || wo.quantityDone || 0;
    
    if (!routingGroups.has(routing)) {
      routingGroups.set(routing, {
        routing,
        workCenters: new Map(),
        totalMoQuantity: 0,
        totalWorkOrders: 0,
      });
    }

    const routingGroup = routingGroups.get(routing)!;
    
    if (!routingGroup.workCenters.has(workCenter)) {
      routingGroup.workCenters.set(workCenter, {
        totalMoQuantity: 0,
        totalCycleDurationSeconds: 0,
        observations: 0,
        workOrderIds: new Set(),
        operators: new Set(),
        operations: new Set(),
      });
    }

    const wcGroup = routingGroup.workCenters.get(workCenter)!;
    
    // Add work order data
    wcGroup.totalMoQuantity += moQuantity;
    routingGroup.totalMoQuantity += moQuantity;
    
    // Use cycle duration if available, otherwise convert actual hours to seconds
    const durationSeconds = wo.totalCycleDuration ?? ((wo.actualHours ?? 0) * 3600);
    wcGroup.totalCycleDurationSeconds += durationSeconds;
    wcGroup.observations += 1;
    wcGroup.workOrderIds.add(wo.id);
    wcGroup.operators.add(operatorName);
    wcGroup.operations.add(operation);
    
    routingGroup.totalWorkOrders += 1;
  }

  // Step 3: Convert to final result format
  const results: AuthenticUphResult[] = [];
  
  for (const routingGroup of routingGroups.values()) {
    const workCenters: Record<string, any> = {};
    
    for (const [wcName, wcData] of routingGroup.workCenters.entries()) {
      if (wcData.totalCycleDurationSeconds > 0 && wcData.totalMoQuantity > 0) {
        const totalHours = wcData.totalCycleDurationSeconds / 3600;
        const unitsPerHour = wcData.totalMoQuantity / totalHours;
        
        workCenters[wcName] = {
          unitsPerHour: Math.round(unitsPerHour * 100) / 100,
          totalQuantity: wcData.totalMoQuantity,
          totalHours: Math.round(totalHours * 100) / 100,
          observations: wcData.observations,
          operators: Array.from(wcData.operators),
          operations: Array.from(wcData.operations),
        };
      }
    }
    
    if (Object.keys(workCenters).length > 0) {
      results.push({
        routing: routingGroup.routing,
        workCenters,
        totalMoQuantity: routingGroup.totalMoQuantity,
        totalWorkOrders: routingGroup.totalWorkOrders,
      });
    }
  }

  console.log(`Calculated authentic UPH for ${results.length} routing combinations`);
  return results;
}

/**
 * Store authentic UPH results in database
 */
export async function storeAuthenticUphResults(results: AuthenticUphResult[]): Promise<void> {
  const { historicalUph } = await import("../shared/schema.js");
  const { db } = await import("./db.js");

  console.log(`Storing ${results.length} authentic UPH calculations in database...`);

  // Clear existing historical UPH data
  await db.delete(historicalUph);

  // Flatten work centers for storage - each work center becomes a separate record
  const insertData: any[] = [];
  
  for (const result of results) {
    for (const [wcName, wcData] of Object.entries(result.workCenters)) {
      insertData.push({
        routing: result.routing,
        operation: wcData.operations.join(', '),
        operator: wcData.operators.join(', '),
        workCenter: wcName,
        totalQuantity: wcData.totalQuantity,
        totalHours: wcData.totalHours,
        unitsPerHour: wcData.unitsPerHour,
        observations: wcData.observations,
        dataSource: "authentic_production_schema",
      });
    }
  }

  if (insertData.length > 0) {
    await db.insert(historicalUph).values(insertData);
    console.log(`Successfully stored ${insertData.length} authentic UPH records`);
  }
}