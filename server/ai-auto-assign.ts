import OpenAI from "openai";
import { db } from "./db.js";
import { workOrders, operators, workOrderAssignments, productionOrders, uphData } from "../shared/schema.js";
import { eq, and, inArray, isNull, isNotNull, gt, sql, desc } from "drizzle-orm";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Helper function to group work orders by routing
function groupWorkOrdersByRouting(workOrdersData: any[]) {
  const routingGroups = new Map<string, any[]>();
  
  for (const wo of workOrdersData) {
    const routing = wo.routing || "Unknown";
    if (!routingGroups.has(routing)) {
      routingGroups.set(routing, []);
    }
    routingGroups.get(routing)!.push(wo);
  }
  
  return routingGroups;
}

interface OperatorProfile {
  id: number;
  name: string;
  skills: string[];
  currentCapacity: number;
  maxHours: number;
  hoursAssigned: number;
  activeAssignments: number;
  uphData: Map<string, { uph: number; observations: number }>;
}

interface WorkOrderData {
  workOrderId: number;
  moNumber: string;
  routing: string;
  quantity: number;
  workCenter: string;
  operation: string;
  expectedHours: number;
  sequence: number;
}

interface RoutingAssignmentResult {
  routing: string;
  workOrderCount: number;
  success: boolean;
  assignedCount: number;
  failedCount: number;
  retryAttempts: number;
  error?: string;
}

interface AutoAssignResult {
  success: boolean;
  assignments: number[];
  unassigned: number[];
  summary: string;
  totalHoursOptimized: number;
  operatorUtilization: Map<number, number>;
  routingResults?: RoutingAssignmentResult[];
  progress?: {
    current: number;
    total: number;
    currentRouting?: string;
  };
}

// Helper function to get UPH for an operator on a specific work center and routing
async function getOperatorUPH(
  operatorId: number,
  workCenter: string,
  routing: string
): Promise<number | null> {
  try {
    // Handle routing mapping for products that use different manufacturing routing
    // Lifetime Air Harness products use Lifetime Harness routing for manufacturing
    const routingsToCheck = [routing];
    if (routing === 'Lifetime Air Harness') {
      routingsToCheck.push('Lifetime Harness');
    }
    
    // First try exact routing match
    for (const checkRouting of routingsToCheck) {
      const uphResults = await db
        .select()
        .from(uphData)
        .where(
          and(
            eq(uphData.operatorId, operatorId),
            eq(uphData.workCenter, workCenter),
            eq(uphData.productRouting, checkRouting)
          )
        )
        .limit(1);

      if (uphResults.length > 0 && uphResults[0].uph) {
        return uphResults[0].uph;
      }

      // Check alternate work centers
      const alternateWorkCenters = workCenter === "Assembly" ? ["Sewing", "Rope"] : [];
      for (const altWC of alternateWorkCenters) {
        const altUphResults = await db
          .select()
          .from(uphData)
          .where(
            and(
              eq(uphData.operatorId, operatorId),
              eq(uphData.workCenter, altWC),
              eq(uphData.productRouting, checkRouting)
            )
          )
          .limit(1);

        if (altUphResults.length > 0 && altUphResults[0].uph) {
          return altUphResults[0].uph;
        }
      }
    }

    // If no exact routing match, fall back to average UPH for the work center
    const avgUphResults = await db
      .select({
        avgUph: sql<number>`AVG(${uphData.uph})`
      })
      .from(uphData)
      .where(
        and(
          eq(uphData.operatorId, operatorId),
          eq(uphData.workCenter, workCenter)
        )
      );

    if (avgUphResults.length > 0 && avgUphResults[0].avgUph) {
      return avgUphResults[0].avgUph;
    }

    // Check alternate work centers for average
    if (workCenter === "Assembly") {
      const altAvgResults = await db
        .select({
          avgUph: sql<number>`AVG(${uphData.uph})`
        })
        .from(uphData)
        .where(
          and(
            eq(uphData.operatorId, operatorId),
            inArray(uphData.workCenter, ["Sewing", "Rope"])
          )
        );

      if (altAvgResults.length > 0 && altAvgResults[0].avgUph) {
        return altAvgResults[0].avgUph;
      }
    }

    return null;
  } catch (error) {
    console.error("Error fetching operator UPH:", error);
    return null;
  }
}

// Analyze overloaded operators and recommend rebalancing
async function rebalanceOverloadedOperators(
  assignments: Map<number, WorkOrderData[]>,
  operatorProfiles: Map<number, OperatorProfile>
): Promise<Map<number, number>> {
  const reassignments = new Map<number, number>();
  
  // Find overloaded operators (>90% capacity)
  const overloadedOperators: number[] = [];
  const underutilizedOperators: number[] = [];
  
  for (const [opId, profile] of operatorProfiles) {
    const utilization = (profile.hoursAssigned / profile.maxHours) * 100;
    if (utilization > 90) {
      overloadedOperators.push(opId);
    } else if (utilization < 80) {
      underutilizedOperators.push(opId);
    }
  }
  
  if (overloadedOperators.length === 0 || underutilizedOperators.length === 0) {
    return reassignments; // No rebalancing needed
  }
  
  // Prepare data for AI rebalancing
  const overloadedData = overloadedOperators.map(opId => {
    const profile = operatorProfiles.get(opId)!;
    const workOrders = assignments.get(opId) || [];
    return {
      operatorId: opId,
      operatorName: profile.name,
      currentHours: profile.hoursAssigned,
      maxHours: profile.maxHours,
      utilization: (profile.hoursAssigned / profile.maxHours) * 100,
      workOrders: workOrders.map(wo => ({
        id: wo.workOrderId,
        moNumber: wo.moNumber,
        routing: wo.routing,
        workCenter: wo.workCenter,
        quantity: wo.quantity,
        expectedHours: wo.expectedHours
      }))
    };
  });
  
  const underutilizedData = underutilizedOperators.map(opId => {
    const profile = operatorProfiles.get(opId)!;
    return {
      operatorId: opId,
      operatorName: profile.name,
      currentHours: profile.hoursAssigned,
      maxHours: profile.maxHours,
      utilization: (profile.hoursAssigned / profile.maxHours) * 100,
      skills: profile.skills,
      uphData: Array.from(profile.uphData.entries()).map(([key, data]) => ({
        workCenterRouting: key,
        uph: data.uph,
        observations: data.observations
      }))
    };
  });
  
  const systemMessage = `You are an expert manufacturing scheduler. Your task is to rebalance work orders from overloaded operators (>90% capacity) to underutilized operators (<80% capacity).

Consider:
1. Operator skills and UPH performance on specific work centers and routings
2. Current utilization levels
3. Work order requirements (routing, work center, quantity)
4. Minimize disruption - only reassign what's necessary

Return a JSON array of reassignments:
[
  {
    "workOrderId": number,
    "fromOperatorId": number,
    "toOperatorId": number,
    "reasoning": "brief explanation"
  }
]`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: JSON.stringify({
            overloadedOperators: overloadedData,
            underutilizedOperators: underutilizedData
          })
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const rebalanceData = JSON.parse(response.choices[0].message.content || "{}");
    const reassignmentList = rebalanceData.reassignments || [];
    
    // Convert to map format
    for (const item of reassignmentList) {
      reassignments.set(item.workOrderId, item.toOperatorId);
    }
    
  } catch (error) {
    console.error("AI rebalancing failed:", error);
  }
  
  return reassignments;
}

export async function autoAssignWorkOrders(): Promise<AutoAssignResult> {
  try {
    // Step 1: Get all production orders directly from Fulfil service
    const { FulfilCurrentService } = await import('./fulfil-current.js');
    const fulfilService = new FulfilCurrentService();
    
    let allProductionOrders = [];
    try {
      allProductionOrders = await fulfilService.getCurrentProductionOrders();
      console.log(`Auto-assign: Fetched ${allProductionOrders.length} production orders from Fulfil`);
    } catch (error) {
      console.error("Failed to fetch production orders for auto-assign:", error);
      throw new Error("Failed to fetch production orders from Fulfil API");
    }
    
    const allWorkOrders = [];
    
    // Extract all work orders from production orders
    for (const po of allProductionOrders) {
      if (po.workOrders && Array.isArray(po.workOrders)) {
        for (const wo of po.workOrders) {
          // Only consider non-finished work orders
          if (wo.state !== 'finished') {
            allWorkOrders.push({
              workOrderId: wo.id,
              moNumber: po.moNumber,
              routing: po.routing,
              quantity: po.quantity,
              workCenter: wo.workCenter || wo.originalWorkCenter,
              operation: wo.operation,
              sequence: 1,
              productionOrderId: po.id,
              state: wo.state
            });
          }
        }
      }
    }
    
    // Get existing assignments
    const existingAssignments = await db
      .select({
        workOrderId: workOrderAssignments.workOrderId,
      })
      .from(workOrderAssignments)
      .where(eq(workOrderAssignments.isActive, true));
    
    const assignedWorkOrderIds = new Set(existingAssignments.map(a => a.workOrderId));
    
    // Filter unassigned work orders
    const unassignedWorkOrders = allWorkOrders.filter(wo => !assignedWorkOrderIds.has(wo.workOrderId));

    if (unassignedWorkOrders.length === 0) {
      return {
        success: true,
        assignments: [],
        unassigned: [],
        summary: "No unassigned work orders found",
        totalHoursOptimized: 0,
        operatorUtilization: new Map()
      };
    }
    
    console.log(`Found ${unassignedWorkOrders.length} unassigned work orders`);

    // Step 2: Get all active operators with their UPH data
    const activeOperators = await db
      .select()
      .from(operators)
      .where(eq(operators.isActive, true));

    // Build operator profiles with UPH data
    const operatorProfiles = new Map<number, OperatorProfile>();
    
    for (const op of activeOperators) {
      const operatorUphMap = new Map<string, { uph: number; observations: number }>();
      
      // Get all UPH data for this operator using name-based lookup
      const operatorUphData = await db
        .select()
        .from(uphData)
        .where(eq(uphData.operatorName, op.name));
      
      for (const uphRecord of operatorUphData) {
        const key = `${uphRecord.workCenter}-${uphRecord.productRouting}`;
        operatorUphMap.set(key, {
          uph: uphRecord.uph || 0,
          observations: uphRecord.observationCount || 0
        });
      }
      
      operatorProfiles.set(op.id, {
        id: op.id,
        name: op.name,
        skills: [...(op.workCenters || []), ...(op.routings || [])],
        currentCapacity: 0,
        maxHours: op.availableHours || 40,
        hoursAssigned: 0,
        activeAssignments: 0,
        uphData: operatorUphMap
      });
    }

    // Map existing hours per operator
    const existingHours = await db
      .select({
        operatorId: workOrderAssignments.operatorId,
        hours: sql<number>`SUM(${workOrderAssignments.estimatedHours})`
      })
      .from(workOrderAssignments)
      .where(eq(workOrderAssignments.isActive, true))
      .groupBy(workOrderAssignments.operatorId);

    const hoursMap = new Map<number, number>();
    for (const row of existingHours) {
      hoursMap.set(row.operatorId, Number(row.hours || 0));
    }

    for (const [opId, profile] of operatorProfiles) {
      profile.hoursAssigned = hoursMap.get(opId) || 0;
    }

    const assignmentRecords: any[] = [];
    const successfulAssignments: number[] = [];
    const failedAssignments: number[] = [];

    for (const wo of unassignedWorkOrders) {
      const candidates: { opId: number; uph: number; hours: number }[] = [];

      for (const [opId, profile] of operatorProfiles) {
        const operator = activeOperators.find(o => o.id === opId);
        if (!operator) continue;

        // Work center eligibility
        let hasWC = false;
        if (wo.workCenter === 'Assembly') {
          hasWC = operator.workCenters?.includes('Assembly') ||
                   operator.workCenters?.includes('Sewing') ||
                   operator.workCenters?.includes('Rope');
        } else {
          hasWC = operator.workCenters?.includes(wo.workCenter);
        }
        if (!hasWC) continue;

        const routingToCheck = wo.routing === 'Lifetime Air Harness' ? 'Lifetime Harness' : wo.routing;
        if (!operator.routings?.includes(routingToCheck)) continue;

        const uphEntry = profile.uphData.get(`${wo.workCenter}-${routingToCheck}`);
        if (!uphEntry || uphEntry.uph <= 0) continue;

        const qty = wo.quantity > 0 ? wo.quantity : 0;
        if (qty === 0) continue;

        const hoursNeeded = qty / uphEntry.uph;
        if (profile.hoursAssigned + hoursNeeded > profile.maxHours) continue;

        candidates.push({ opId, uph: uphEntry.uph, hours: hoursNeeded });
      }

      if (candidates.length === 0) {
        failedAssignments.push(wo.workOrderId);
        continue;
      }

      candidates.sort((a, b) => b.uph - a.uph);
      const best = candidates[0];
      const profile = operatorProfiles.get(best.opId)!;
      profile.hoursAssigned += best.hours;

      assignmentRecords.push({
        workOrderId: wo.workOrderId,
        operatorId: best.opId,
        assignedBy: 'AI Auto-Assign',
        assignedAt: new Date(),
        isActive: true,
        isAutoAssigned: true,
        estimatedHours: best.hours,
        autoAssignReason: `Auto-assigned based on UPH (${best.uph.toFixed(1)} UPH)`,
        autoAssignConfidence: 0.75
      });

      successfulAssignments.push(wo.workOrderId);
    }

    if (assignmentRecords.length > 0) {
      const workOrderIds = assignmentRecords.map(a => a.workOrderId);
      await db
        .delete(workOrderAssignments)
        .where(and(inArray(workOrderAssignments.workOrderId, workOrderIds), eq(workOrderAssignments.assignedBy, 'AI Auto-Assign')));
      await db.insert(workOrderAssignments).values(assignmentRecords);
    }

    const operatorUtilization = new Map<number, number>();
    let totalHoursOptimized = 0;
    for (const [opId, profile] of operatorProfiles) {
      const utilization = (profile.hoursAssigned / profile.maxHours) * 100;
      operatorUtilization.set(opId, utilization);
      totalHoursOptimized += profile.hoursAssigned;
    }

    return {
      success: successfulAssignments.length > 0,
      assignments: successfulAssignments,
      unassigned: failedAssignments,
      summary: successfulAssignments.length > 0 ? `Auto-assigned ${successfulAssignments.length} work orders` : 'No assignments could be made',
      totalHoursOptimized,
      operatorUtilization
    };
  } catch (error) {
    console.error("Auto-assign error:", error);
    return {
      success: false,
      assignments: [],
      unassigned: [],
      summary: error instanceof Error ? error.message : "Auto-assign failed",
      totalHoursOptimized: 0,
      operatorUtilization: new Map()
    };
  }
}

// Try different assignment strategies
export async function regenerateAssignments(): Promise<AutoAssignResult> {
  // Clear existing auto-assignments
  await db
    .delete(workOrderAssignments)
    .where(eq(workOrderAssignments.assignedBy, "AI Auto-Assign"));
    
  // Run auto-assign with higher temperature for variation
  return autoAssignWorkOrders();
}

// Clear all assignments
export async function clearAllAssignments(): Promise<{ success: boolean; cleared: number }> {
  try {
    const result = await db
      .delete(workOrderAssignments)
      .where(eq(workOrderAssignments.isActive, true));
      
    return {
      success: true,
      cleared: result.rowCount || 0
    };
  } catch (error) {
    console.error("Error clearing assignments:", error);
    return {
      success: false,
      cleared: 0
    };
  }
}

// Clear assignments by optional work center and routing filter
export async function clearAssignmentsByFilter({
  workCenter,
  routing,
}: { workCenter?: string; routing?: string }): Promise<{ success: boolean; cleared: number }> {
  try {
    const conditions = [] as any[];

    if (workCenter) {
      conditions.push(
        inArray(
          workOrderAssignments.workOrderId,
          sql`(select ${workOrders.id} from ${workOrders} where ${workOrders.workCenter} = ${workCenter})`
        )
      );
    }
    if (routing) {
      conditions.push(
        inArray(
          workOrderAssignments.workOrderId,
          sql`(select ${workOrders.id} from ${workOrders} where ${workOrders.routing} = ${routing})`
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const result = await db.delete(workOrderAssignments).where(whereClause);

    return { success: true, cleared: result.rowCount || 0 };
  } catch (error) {
    console.error("Error clearing assignments by filter:", error);
    return { success: false, cleared: 0 };
  }
}
