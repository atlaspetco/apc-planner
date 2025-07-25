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

    // Step 3: Group work orders by routing for batch processing
    const routingGroups = groupWorkOrdersByRouting(unassignedWorkOrders);
    const routingResults: RoutingAssignmentResult[] = [];
    
    // Step 4: Process each routing group with AI
    const allAssignments = new Map<number, WorkOrderData[]>();
    const successfulAssignments: number[] = [];
    const failedAssignments: number[] = [];
    
    let currentRoutingIndex = 0;
    const totalRoutings = routingGroups.size;
    
    for (const [routing, workOrdersInGroup] of routingGroups) {
      currentRoutingIndex++;
      console.log(`Processing routing ${currentRoutingIndex}/${totalRoutings}: ${routing} (${workOrdersInGroup.length} work orders)`);
      
      const routingResult: RoutingAssignmentResult = {
        routing,
        workOrderCount: workOrdersInGroup.length,
        success: false,
        assignedCount: 0,
        failedCount: 0,
        retryAttempts: 0
      };
      
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
      const operatorsWithRoutingExperience = [];
      const operatorsWithWorkCenterExperience = [];
      
      // Get all unique work centers needed for this routing group
      const workCentersNeeded = new Set(workOrdersInGroup.map(wo => wo.workCenter));
      
      for (const [opId, profile] of operatorProfiles) {
        // First check if operator has all required work centers enabled
        const operator = activeOperators.find(op => op.id === opId);
        if (!operator) continue;
        
        const operatorWorkCenters = operator.workCenters || [];
        const hasRequiredWorkCenters = Array.from(workCentersNeeded).every(wc => {
          // Handle Assembly work center - operator can have Assembly, Sewing, or Rope
          if (wc === 'Assembly') {
            return operatorWorkCenters.includes('Assembly') || 
                   operatorWorkCenters.includes('Sewing') || 
                   operatorWorkCenters.includes('Rope');
          }
          return operatorWorkCenters.includes(wc);
        });
        
        if (!hasRequiredWorkCenters) {
          continue; // Skip this operator if they don't have required work centers enabled
        }
        
        // Handle routing mapping for products that use different manufacturing routing
        // Lifetime Air Harness products use Lifetime Harness routing for manufacturing
        const routingsToCheck = [routing];
        if (routing === 'Lifetime Air Harness') {
          routingsToCheck.push('Lifetime Harness');
        }
        
        // Check for exact routing experience
        const hasRoutingExperience = Array.from(profile.uphData.keys()).some(key => 
          routingsToCheck.some(r => key.includes(r))
        );
        
        // Check for work center experience (fallback if no routing experience)
        const hasWorkCenterExperience = Array.from(workCentersNeeded).some(wc => 
          Array.from(profile.uphData.keys()).some(key => key.startsWith(`${wc}-`))
        );
        
        if (hasRoutingExperience) {
          operatorsWithRoutingExperience.push({
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
        } else if (hasWorkCenterExperience) {
          // Fallback to work center experience
          operatorsWithWorkCenterExperience.push({
            id: opId,
            name: profile.name,
            currentCapacity: (profile.hoursAssigned / profile.maxHours) * 100,
            remainingHours: profile.maxHours - profile.hoursAssigned,
            uphPerformance: Array.from(profile.uphData.entries())
              .filter(([key]) => Array.from(workCentersNeeded).some(wc => key.startsWith(`${wc}-`)))
              .map(([key, data]) => ({
                workCenterRouting: key,
                uph: data.uph,
                observations: data.observations
              }))
          });
        }
      }
      
      // Prefer operators with exact routing experience, but fall back to work center experience
      if (operatorsWithRoutingExperience.length > 0) {
        qualifiedOperators.push(...operatorsWithRoutingExperience);
      } else if (operatorsWithWorkCenterExperience.length > 0) {
        console.log(`No operators with ${routing} experience, using operators with work center experience`);
        qualifiedOperators.push(...operatorsWithWorkCenterExperience);
      }
      
      if (qualifiedOperators.length === 0) {
        console.log(`No qualified operators found for routing: ${routing}`);
        failedAssignments.push(...workOrderData.map(wo => wo.workOrderId));
        routingResult.failedCount = workOrderData.length;
        routingResult.error = "No qualified operators found";
        routingResults.push(routingResult);
        continue;
      }
      
      // Try up to 2 times to assign work orders for this routing
      const maxRetries = 2;
      let assignmentSuccess = false;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        routingResult.retryAttempts = attempt;
        console.log(`Attempt ${attempt}/${maxRetries} for routing: ${routing}`);
        
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
          let routingAssignedCount = 0;
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
            routingAssignedCount++;
          }
          
          if (routingAssignedCount > 0) {
            assignmentSuccess = true;
            routingResult.success = true;
            routingResult.assignedCount = routingAssignedCount;
            routingResult.failedCount = workOrderData.length - routingAssignedCount;
            break; // Success, no need to retry
          }
          
        } catch (error) {
          console.error(`AI assignment failed for routing ${routing} (attempt ${attempt}):`, error);
          routingResult.error = error instanceof Error ? error.message : "AI assignment failed";
          
          if (attempt === maxRetries) {
            // Final attempt failed
            failedAssignments.push(...workOrderData.map(wo => wo.workOrderId));
            routingResult.failedCount = workOrderData.length;
          }
          // Otherwise, continue to next attempt
        }
      }
      
      routingResults.push(routingResult);
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
    
    // Insert assignments with better error handling
    let savedCount = 0;
    const actualSavedAssignments: number[] = [];
    
    if (assignmentRecords.length > 0) {
      console.log(`Saving ${assignmentRecords.length} assignments to database...`);
      
      // First, clear any existing AI assignments for these work orders
      const workOrderIds = assignmentRecords.map(a => a.workOrderId);
      try {
        await db
          .delete(workOrderAssignments)
          .where(
            and(
              inArray(workOrderAssignments.workOrderId, workOrderIds),
              eq(workOrderAssignments.assignedBy, "AI Auto-Assign")
            )
          );
      } catch (deleteError) {
        console.error("Error clearing existing assignments:", deleteError);
      }
      
      // Insert in smaller batches to avoid database timeouts
      const batchSize = 20;
      
      for (let i = 0; i < assignmentRecords.length; i += batchSize) {
        const batch = assignmentRecords.slice(i, i + batchSize);
        try {
          await db.insert(workOrderAssignments).values(batch);
          savedCount += batch.length;
          actualSavedAssignments.push(...batch.map(b => b.workOrderId));
          console.log(`Saved ${savedCount}/${assignmentRecords.length} assignments...`);
        } catch (batchError) {
          console.error(`Error inserting batch ${i/batchSize + 1}:`, batchError);
          // Try individual inserts for failed batch
          for (const record of batch) {
            try {
              await db.insert(workOrderAssignments).values([record]);
              savedCount++;
              actualSavedAssignments.push(record.workOrderId);
            } catch (individualError) {
              console.error(`Failed to save assignment for WO ${record.workOrderId}:`, individualError);
              failedAssignments.push(record.workOrderId);
            }
          }
        }
      }
      
      console.log(`Successfully saved ${savedCount} out of ${assignmentRecords.length} assignments`);
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
    let summary = "";
    const successfulRoutings = routingResults.filter(r => r.success);
    const failedRoutings = routingResults.filter(r => !r.success);
    
    if (savedCount > 0) {
      summary += `Successfully saved ${savedCount} work order assignments.`;
    }
    
    if (failedRoutings.length > 0) {
      summary += ` Failed to assign work orders for ${failedRoutings.length} routings: ${failedRoutings.map(r => `${r.routing} (${r.error || 'Unknown error'})`).join(', ')}.`;
    }
    
    if (unassignableWorkOrders.length > 0) {
      summary += ` ${unassignableWorkOrders.length} work orders couldn't be assigned (no operators with historical data).`;
    }
    
    // Success is determined by actual saved assignments, not just AI planning
    const isSuccess = savedCount > 0;
    
    return {
      success: isSuccess,
      assignments: successfulAssignments.filter(id => actualSavedAssignments.includes(id)),
      unassigned: [...actualFailures, ...unassignableWorkOrders],
      summary: summary.trim() || (isSuccess ? "Auto-assign completed" : "No assignments could be made"),
      totalHoursOptimized,
      operatorUtilization,
      routingResults,
      progress: {
        current: totalRoutings,
        total: totalRoutings
      }
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
