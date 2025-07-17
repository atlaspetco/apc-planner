import OpenAI from "openai";
import { db } from "./db.js";
import { 
  workOrderAssignments, 
  operators, 
  workOrders, 
  productionOrders,
  historicalUph 
} from "@shared/schema.js";
import { eq, and, sql, inArray, gt, notInArray } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface OperatorProfile {
  id: number;
  name: string;
  slackUserId?: string;
  isActive: boolean;
  workCenters: string[];
  operations: string[];
  routings: string[];
  uphPerformance: Map<string, {
    avgUph: number;
    observations: number;
    workCenter: string;
    routing: string;
  }>;
  currentAssignments: number;
  hoursAssigned: number;
  maxHours: number;
}

interface WorkOrderToAssign {
  id: number;
  workCenter: string;
  operation: string;
  routing: string;
  quantity: number;
  productionOrderId: number;
  moNumber: string;
  productName: string;
}

interface AssignmentRecommendation {
  workOrderId: number;
  operatorId: number;
  operatorName: string;
  reason: string;
  expectedUph: number;
  expectedHours: number;
  confidence: number;
  isAutoAssigned: boolean;
}

interface AutoAssignResult {
  success: boolean;
  assignments: AssignmentRecommendation[];
  unassigned: number[];
  summary: string;
  totalHoursOptimized: number;
  operatorUtilization: Map<number, number>;
}

// Prepare operator profiles with historical performance data
export async function prepareOperatorProfiles(): Promise<Map<number, OperatorProfile>> {
  const operatorMap = new Map<number, OperatorProfile>();
  
  // Get all active operators
  const activeOperators = await db
    .select()
    .from(operators)
    .where(eq(operators.isActive, true));
    
  // Get historical UPH data
  const uphData = await db
    .select()
    .from(historicalUph);
    
  // Get current assignments with work order details
  const assignmentsRaw = await db
    .select()
    .from(workOrderAssignments)
    .leftJoin(workOrders, eq(workOrderAssignments.workOrderId, workOrders.id))
    .where(eq(workOrderAssignments.isActive, true));
    
  // Transform to required format
  const currentAssignments = assignmentsRaw.map(row => ({
    operatorId: row.work_order_assignments.operatorId,
    workOrderId: row.work_order_assignments.workOrderId,
    quantity: row.work_orders?.quantity || 0,
    workCenter: row.work_orders?.workCenter || '',
    routing: row.work_orders?.routing || ''
  }));
    
  // Build operator profiles
  for (const operator of activeOperators) {
    const profile: OperatorProfile = {
      id: operator.id,
      name: operator.name,
      slackUserId: operator.slackUserId || undefined,
      isActive: operator.isActive,
      workCenters: operator.workCenters || [],
      operations: operator.operations || [],
      routings: operator.routings || [],
      uphPerformance: new Map(),
      currentAssignments: 0,
      hoursAssigned: 0,
      maxHours: operator.availableHours || 40
    };
    
    // Add UPH performance data
    const operatorUph = uphData.filter(u => u.operator === operator.name);
    for (const uph of operatorUph) {
      const key = `${uph.workCenter}-${uph.routing}`;
      profile.uphPerformance.set(key, {
        avgUph: uph.unitsPerHour,
        observations: uph.observations,
        workCenter: uph.workCenter,
        routing: uph.routing
      });
    }
    
    // Calculate current assignment hours
    const operatorAssignments = currentAssignments.filter(a => a.operatorId === operator.id);
    profile.currentAssignments = operatorAssignments.length;
    
    for (const assignment of operatorAssignments) {
      const uphKey = `${assignment.workCenter}-${assignment.routing}`;
      const performance = profile.uphPerformance.get(uphKey);
      if (performance && assignment.quantity) {
        profile.hoursAssigned += assignment.quantity / performance.avgUph;
      }
    }
    
    operatorMap.set(operator.id, profile);
  }
  
  return operatorMap;
}

// Get unassigned work orders
export async function getUnassignedWorkOrders(): Promise<WorkOrderToAssign[]> {
  try {
    // Get assigned work order IDs from assignments table
    const assignedWorkOrderIds = await db
      .select({ workOrderId: workOrderAssignments.workOrderId })
      .from(workOrderAssignments)
      .where(eq(workOrderAssignments.isActive, true));
      
    const assignedIds = new Set(assignedWorkOrderIds.map(a => a.workOrderId));
    console.log(`Found ${assignedIds.size} work orders with active assignments`);
    
    // Get production orders and work orders from database
    const productionOrdersData = await db
      .select({
        id: productionOrders.id,
        moNumber: productionOrders.moNumber,
        quantity: productionOrders.quantity,
        routing: productionOrders.routing,
        status: productionOrders.status,
        state: productionOrders.state
      })
      .from(productionOrders)
      .where(
        and(
          not(eq(productionOrders.status, 'Done')),
          not(eq(productionOrders.state, 'done'))
        )
      );
    console.log(`Found ${productionOrdersData.length} active production orders in database`);
    
    // Get work orders for active production orders
    const workOrdersData = await db
      .select({
        id: workOrders.id,
        workCenter: workOrders.workCenter,
        operation: workOrders.operation,
        routing: workOrders.routing,
        quantity: workOrders.quantity,
        productionOrderId: workOrders.productionOrderId,
        moNumber: workOrders.moNumber,
        state: workOrders.state
      })
      .from(workOrders)
      .where(
        inArray(
          workOrders.productionOrderId,
          productionOrdersData.map(po => po.id)
        )
      );
    
    console.log(`Found ${workOrdersData.length} work orders for active production orders`);
    
    // Extract all unassigned work orders
    const unassignedWorkOrders: WorkOrderToAssign[] = [];
    
    for (const wo of workOrdersData) {
      // Skip if already assigned or if state is finished/done
      if (assignedIds.has(wo.id) || wo.state === 'finished' || wo.state === 'done') {
        continue;
      }
      
      const mo = productionOrdersData.find(p => p.id === wo.productionOrderId);
      if (!mo || !mo.quantity || mo.quantity <= 0) continue;
      
      // Add to unassigned list
      unassignedWorkOrders.push({
        id: wo.id,
        workCenter: wo.workCenter || 'Unknown',
        operation: wo.operation || '',
        routing: wo.routing || mo.routing || '',
        quantity: wo.quantity || mo.quantity,
        productionOrderId: wo.productionOrderId,
        moNumber: wo.moNumber || mo.moNumber || '',
        productName: mo.productName || ''
      });
    }
    
    console.log(`Found ${unassignedWorkOrders.length} unassigned work orders to process`);
    console.log('Sample unassigned work orders:', unassignedWorkOrders.slice(0, 3));
    return unassignedWorkOrders;
  } catch (error) {
    console.error('Error in getUnassignedWorkOrders:', error);
    throw error;
  }
}

// Generate AI-powered assignment recommendations
export async function generateAssignmentRecommendations(
  workOrders: WorkOrderToAssign[],
  operatorProfiles: Map<number, OperatorProfile>
): Promise<AssignmentRecommendation[]> {
  
  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not found in environment variables");
    throw new Error("OpenAI API key is required for auto-assign feature. Please add OPENAI_API_KEY to your environment secrets.");
  }
  
  // Prepare data for AI analysis
  const operatorData = Array.from(operatorProfiles.values()).map(op => ({
    id: op.id,
    name: op.name,
    availableHours: Math.max(0, op.maxHours - op.hoursAssigned),
    workCenters: op.workCenters,
    routings: op.routings,
    performance: Array.from(op.uphPerformance.entries()).map(([key, perf]) => ({
      key,
      workCenter: perf.workCenter,
      routing: perf.routing,
      avgUph: perf.avgUph,
      observations: perf.observations
    }))
  }));
  
  const workOrderData = workOrders.map(wo => ({
    id: wo.id,
    moNumber: wo.moNumber,
    productName: wo.productName,
    workCenter: wo.workCenter,
    operation: wo.operation,
    routing: wo.routing,
    quantity: wo.quantity
  }));
  
  const prompt = `You are an expert production scheduler optimizing operator assignments for manufacturing efficiency.

OPERATORS (${operatorData.length} available):
${JSON.stringify(operatorData, null, 2)}

WORK ORDERS TO ASSIGN (${workOrderData.length} unassigned):
${JSON.stringify(workOrderData, null, 2)}

CONSTRAINTS:
1. Operators can only work on work centers they are qualified for
2. Operators can only work on routings they have experience with
3. Respect available hours (don't exceed operator capacity)
4. Use historical UPH data to estimate task duration
5. Prioritize operators with more observations (experience) for critical tasks

OPTIMIZATION GOALS:
1. Minimize total production hours
2. Balance workload across operators
3. Match operator strengths to appropriate tasks
4. Ensure all constraints are satisfied

For each work order, recommend the best operator assignment considering:
- Historical performance (UPH) on similar tasks
- Current workload and availability
- Qualification constraints

Respond with JSON format:
{
  "assignments": [
    {
      "workOrderId": number,
      "operatorId": number,
      "operatorName": string,
      "reason": "specific explanation of why this operator was chosen",
      "expectedUph": number,
      "expectedHours": number (quantity / expectedUph),
      "confidence": number (0-1, based on historical data quality)
    }
  ],
  "unassigned": [workOrderIds that couldn't be assigned],
  "summary": "Brief optimization summary"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert production scheduler. Provide optimal operator assignments based on constraints and historical performance data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2 // Low temperature for consistent optimization
    });
    
    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    // Convert AI recommendations to our format
    return result.assignments.map((assignment: any) => ({
      ...assignment,
      isAutoAssigned: true
    }));
    
  } catch (error) {
    console.error("Error generating AI assignments:", error);
    throw error;
  }
}

// Main auto-assign function
export async function autoAssignWorkOrders(): Promise<AutoAssignResult> {
  try {
    console.log("Starting auto-assign process...");
    
    // Step 1: Prepare operator profiles with historical data
    const operatorProfiles = await prepareOperatorProfiles();
    console.log(`Prepared ${operatorProfiles.size} operator profiles`);
    
    // Step 2: Get unassigned work orders
    const unassignedWorkOrders = await getUnassignedWorkOrders();
    console.log(`Found ${unassignedWorkOrders.length} unassigned work orders`);
    
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
    
    // Step 3: Generate AI recommendations
    console.log("Generating AI recommendations...");
    const recommendations = await generateAssignmentRecommendations(
      unassignedWorkOrders, 
      operatorProfiles
    );
    
    // Step 4: Apply assignments to database
    const successfulAssignments: AssignmentRecommendation[] = [];
    const failedAssignments: number[] = [];
    
    for (const rec of recommendations) {
      try {
        // Insert assignment
        await db.insert(workOrderAssignments).values({
          workOrderId: rec.workOrderId,
          operatorId: rec.operatorId,
          assignedBy: "AI Auto-Assign",
          assignedAt: new Date(),
          isActive: true,
          isAutoAssigned: true,
          autoAssignReason: rec.reason,
          autoAssignConfidence: rec.confidence
        });
        
        successfulAssignments.push(rec);
        
        // Update operator profile hours
        const profile = operatorProfiles.get(rec.operatorId);
        if (profile) {
          profile.hoursAssigned += rec.expectedHours;
        }
        
      } catch (error) {
        console.error(`Failed to assign WO ${rec.workOrderId}:`, error);
        failedAssignments.push(rec.workOrderId);
      }
    }
    
    // Calculate utilization
    const operatorUtilization = new Map<number, number>();
    let totalHoursOptimized = 0;
    
    for (const [opId, profile] of operatorProfiles) {
      const utilization = (profile.hoursAssigned / profile.maxHours) * 100;
      operatorUtilization.set(opId, utilization);
      totalHoursOptimized += profile.hoursAssigned;
    }
    
    return {
      success: true,
      assignments: successfulAssignments,
      unassigned: failedAssignments,
      summary: `Successfully assigned ${successfulAssignments.length} work orders. ${failedAssignments.length} failed.`,
      totalHoursOptimized,
      operatorUtilization
    };
    
  } catch (error) {
    console.error("Auto-assign error:", error);
    return {
      success: false,
      assignments: [],
      unassigned: [],
      summary: `Auto-assign failed: ${error.message}`,
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

// Clear assignments for specific work center or routing
export async function clearAssignmentsByFilter(
  filter: { workCenter?: string; routing?: string }
): Promise<{ success: boolean; cleared: number }> {
  try {
    // Get work order IDs matching filter
    let query = db
      .select({ id: workOrders.id })
      .from(workOrders);
      
    if (filter.workCenter) {
      query = query.where(eq(workOrders.workCenter, filter.workCenter));
    }
    
    if (filter.routing) {
      query = query
        .leftJoin(productionOrders, eq(workOrders.productionOrderId, productionOrders.id))
        .where(eq(productionOrders.routing, filter.routing));
    }
    
    const workOrderIds = await query;
    const ids = workOrderIds.map(wo => wo.id);
    
    if (ids.length === 0) {
      return { success: true, cleared: 0 };
    }
    
    // Delete assignments for these work orders
    const result = await db
      .delete(workOrderAssignments)
      .where(and(
        inArray(workOrderAssignments.workOrderId, ids),
        eq(workOrderAssignments.isActive, true)
      ));
      
    return {
      success: true,
      cleared: result.rowCount || 0
    };
  } catch (error) {
    console.error("Error clearing filtered assignments:", error);
    return {
      success: false,
      cleared: 0
    };
  }
}