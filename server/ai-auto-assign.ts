import OpenAI from "openai";
import { db } from "./db.js";
import { workOrders, operators, workOrderAssignments, productionOrders, historicalUph } from "../shared/schema.js";
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

interface AutoAssignResult {
  success: boolean;
  assignments: number[];
  unassigned: number[];
  summary: string;
  totalHoursOptimized: number;
  operatorUtilization: Map<number, number>;
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
    
    for (const checkRouting of routingsToCheck) {
      const uphResults = await db
        .select()
        .from(historicalUph)
        .where(
          and(
            eq(historicalUph.operatorId, operatorId),
            eq(historicalUph.workCenter, workCenter),
            eq(historicalUph.routing, checkRouting)
          )
        )
        .limit(1);

      if (uphResults.length > 0 && uphResults[0].unitsPerHour) {
        return uphResults[0].unitsPerHour;
      }

      // Check alternate work centers
      const alternateWorkCenters = workCenter === "Assembly" ? ["Sewing", "Rope"] : [];
      for (const altWC of alternateWorkCenters) {
        const altUphResults = await db
          .select()
          .from(historicalUph)
          .where(
            and(
              eq(historicalUph.operatorId, operatorId),
              eq(historicalUph.workCenter, altWC),
              eq(historicalUph.routing, checkRouting)
            )
          )
          .limit(1);

        if (altUphResults.length > 0 && altUphResults[0].unitsPerHour) {
          return altUphResults[0].unitsPerHour;
        }
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
    // Step 1: Get all production orders with embedded work orders
    const response = await fetch('http://localhost:5000/api/production-orders');
    const allProductionOrders = await response.json();
    
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
      const uphData = new Map<string, { uph: number; observations: number }>();
      
      // Get all UPH data for this operator
      const operatorUphData = await db
        .select()
        .from(historicalUph)
        .where(eq(historicalUph.operatorId, op.id));
      
      for (const uphRecord of operatorUphData) {
        const key = `${uphRecord.workCenter}-${uphRecord.routing}`;
        uphData.set(key, {
          uph: uphRecord.unitsPerHour || 0,
          observations: uphRecord.observations || 0
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
        uphData
      });
    }

    // Step 3: Group work orders by routing for batch processing
    const routingGroups = groupWorkOrdersByRouting(unassignedWorkOrders);
    
    // Step 4: Process each routing group with AI
    const allAssignments = new Map<number, WorkOrderData[]>();
    const successfulAssignments: number[] = [];
    const failedAssignments: number[] = [];
    
    for (const [routing, workOrdersInGroup] of routingGroups) {
      console.log(`Processing ${workOrdersInGroup.length} work orders for routing: ${routing}`);
      
      // Prepare work order data
      const workOrderData: WorkOrderData[] = workOrdersInGroup.map(wo => ({
        workOrderId: wo.workOrderId,
        moNumber: wo.moNumber,
        routing: wo.routing,
        quantity: wo.quantity,
        workCenter: wo.workCenter,
        operation: wo.operation,
        expectedHours: 0, // Will be calculated based on UPH
        sequence: wo.sequence
      }));
      
      // Get operators with experience in this routing
      const qualifiedOperators = [];
      for (const [opId, profile] of operatorProfiles) {
        // Handle routing mapping for products that use different manufacturing routing
        // Lifetime Air Harness products use Lifetime Harness routing for manufacturing
        const routingsToCheck = [routing];
        if (routing === 'Lifetime Air Harness') {
          routingsToCheck.push('Lifetime Harness');
        }
        
        const hasRoutingExperience = Array.from(profile.uphData.keys()).some(key => 
          routingsToCheck.some(r => key.includes(r))
        );
        
        if (hasRoutingExperience) {
          qualifiedOperators.push({
            id: opId,
            name: profile.name,
            currentCapacity: (profile.hoursAssigned / profile.maxHours) * 100,
            remainingHours: profile.maxHours - profile.hoursAssigned,
            uphPerformance: Array.from(profile.uphData.entries())
              .filter(([key]) => routingsToCheck.some(r => key.includes(r)))
              .map(([key, data]) => ({
                workCenterRouting: key,
                uph: data.uph,
                observations: data.observations
              }))
          });
        }
      }
      
      if (qualifiedOperators.length === 0) {
        console.log(`No qualified operators found for routing: ${routing}`);
        failedAssignments.push(...workOrderData.map(wo => wo.workOrderId));
        continue;
      }
      
      // Use AI to assign work orders
      const systemMessage = `You are an expert manufacturing scheduler. Assign work orders to operators based on:
1. Operator's UPH (Units Per Hour) performance for specific work center and routing combinations
2. Current capacity utilization (prefer operators with lower utilization)
3. Number of observations (higher observations = more reliable UPH data)
4. Remaining available hours

Guidelines:
- Calculate expected hours = quantity / UPH
- Don't exceed operator's remaining hours
- Prefer operators with proven performance (high UPH, many observations)
- Balance workload across operators

Return assignments as JSON:
{
  "assignments": [
    {
      "workOrderId": number,
      "operatorId": number,
      "expectedHours": number,
      "reasoning": "brief explanation",
      "confidence": number (0-1)
    }
  ]
}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemMessage },
            {
              role: "user",
              content: JSON.stringify({
                workOrders: workOrderData,
                operators: qualifiedOperators,
                routing: routing
              })
            }
          ],
          temperature: 0.5,
          response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(response.choices[0].message.content || "{}");
        const assignments = aiResponse.assignments || [];
        
        // Process AI assignments
        for (const assignment of assignments) {
          const woData = workOrderData.find(wo => wo.workOrderId === assignment.workOrderId);
          if (!woData) continue;
          
          woData.expectedHours = assignment.expectedHours || 0;
          
          // Update operator profile
          const profile = operatorProfiles.get(assignment.operatorId);
          if (profile) {
            profile.hoursAssigned += assignment.expectedHours;
            profile.activeAssignments++;
            
            // Track assignment for this operator
            if (!allAssignments.has(assignment.operatorId)) {
              allAssignments.set(assignment.operatorId, []);
            }
            allAssignments.get(assignment.operatorId)!.push(woData);
          }
          
          successfulAssignments.push(assignment.workOrderId);
        }
        
      } catch (error) {
        console.error(`AI assignment failed for routing ${routing}:`, error);
        failedAssignments.push(...workOrderData.map(wo => wo.workOrderId));
      }
    }
    
    // Step 5: Check for overloaded operators and rebalance if needed
    const reassignments = await rebalanceOverloadedOperators(allAssignments, operatorProfiles);
    
    // Apply reassignments
    for (const [workOrderId, newOperatorId] of reassignments) {
      // Find current assignment
      let currentOperatorId: number | null = null;
      let workOrderData: WorkOrderData | null = null;
      
      for (const [opId, assignments] of allAssignments) {
        const wo = assignments.find(a => a.workOrderId === workOrderId);
        if (wo) {
          currentOperatorId = opId;
          workOrderData = wo;
          break;
        }
      }
      
      if (currentOperatorId && workOrderData) {
        // Remove from current operator
        const currentAssignments = allAssignments.get(currentOperatorId) || [];
        allAssignments.set(
          currentOperatorId,
          currentAssignments.filter(a => a.workOrderId !== workOrderId)
        );
        
        const currentProfile = operatorProfiles.get(currentOperatorId);
        if (currentProfile) {
          currentProfile.hoursAssigned -= workOrderData.expectedHours;
          currentProfile.activeAssignments--;
        }
        
        // Add to new operator
        if (!allAssignments.has(newOperatorId)) {
          allAssignments.set(newOperatorId, []);
        }
        allAssignments.get(newOperatorId)!.push(workOrderData);
        
        const newProfile = operatorProfiles.get(newOperatorId);
        if (newProfile) {
          newProfile.hoursAssigned += workOrderData.expectedHours;
          newProfile.activeAssignments++;
        }
      }
    }
    
    // Step 6: Save all assignments to database
    const assignmentRecords = [];
    for (const [operatorId, workOrdersList] of allAssignments) {
      for (const wo of workOrdersList) {
        assignmentRecords.push({
          workOrderId: wo.workOrderId,
          operatorId: operatorId,
          assignedBy: "AI Auto-Assign",
          assignedAt: new Date(),
          isActive: true,
          isAutoAssigned: true,
          autoAssignReason: `Assigned based on UPH performance for ${wo.routing} - ${wo.workCenter}`,
          autoAssignConfidence: 0.85
        });
      }
    }
    
    // Insert assignments in batches
    const batchSize = 50;
    for (let i = 0; i < assignmentRecords.length; i += batchSize) {
      const batch = assignmentRecords.slice(i, i + batchSize);
      try {
        await db.insert(workOrderAssignments).values(batch);
      } catch (error) {
        console.error("Error inserting assignment batch:", error);
        // Track failed assignments
        const failedIds = batch.map(a => a.workOrderId);
        failedAssignments.push(...failedIds);
        successfulAssignments.filter(id => !failedIds.includes(id));
      }
    }
    
    // Calculate final metrics
    const operatorUtilization = new Map<number, number>();
    let totalHoursOptimized = 0;
    
    for (const [opId, profile] of operatorProfiles) {
      const utilization = (profile.hoursAssigned / profile.maxHours) * 100;
      operatorUtilization.set(opId, utilization);
      totalHoursOptimized += profile.hoursAssigned;
    }
    
    // Track unassignable work orders (no operators with historical data)
    const unassignableWorkOrders: number[] = [];
    for (const wo of unassignedWorkOrders) {
      const hasQualifiedOperators = [...operatorProfiles.values()].some(profile => {
        const key = `${wo.workCenter}-${wo.routing}`;
        return profile.uphData.has(key);
      });
      
      if (!hasQualifiedOperators) {
        unassignableWorkOrders.push(wo.workOrderId);
        console.log(`No operators with historical data for: ${wo.routing} - ${wo.workCenter}`);
      }
    }
    
    // Calculate actual failed assignments (excluding unassignable)
    const actualFailures = failedAssignments.filter(id => !unassignableWorkOrders.includes(id));
    
    // Create detailed summary
    let summary = `Successfully assigned ${successfulAssignments.length} work orders.`;
    if (unassignableWorkOrders.length > 0) {
      summary += ` ${unassignableWorkOrders.length} work orders couldn't be assigned (no operators with historical data).`;
    }
    if (actualFailures.length > 0) {
      summary += ` ${actualFailures.length} assignments failed.`;
    }
    
    return {
      success: successfulAssignments.length > 0,
      assignments: successfulAssignments,
      unassigned: [...actualFailures, ...unassignableWorkOrders],
      summary,
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
