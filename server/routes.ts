import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { 
  productionOrders, 
  workOrders, 
  operators, 
  workOrderAssignments,
  uphData, 
  batches, 
  workCycles,
  activeWorkOrders
} from "@shared/schema";
import { eq, and, inArray, gt, isNotNull, isNull, or, sql, not, ne } from "drizzle-orm";
import { isAuthenticated } from "./slackAuth";
import { FulfilCurrentService } from "./fulfil-current";
import { calculateCoreUph } from "./uph-core-calculator";
import { enrichProductionOrders, cleanWorkOrderKey } from "./utils/production-order-utils";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware (already setup in server/index.ts)

  // ===========================
  // AUTH ROUTES
  // ===========================
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const user = await db.select().from(operators).where(eq(operators.slackUserId, userId)).limit(1);
      
      if (user.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user[0]);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ===========================
  // PRODUCTION ORDERS ROUTES
  // ===========================
  app.get("/api/production-orders", isAuthenticated, async (req, res) => {
    try {
      console.log('Fetching production orders from Fulfil service (attempt 1/3)...');
      const fulfilService = new FulfilCurrentService();
      const orders = await fulfilService.getCurrentProductionOrders();
      console.log(`Got ${orders.length} production orders from Fulfil service`);
      
      const enrichedOrders = enrichProductionOrders(orders);
      console.log(`Converted to ${enrichedOrders.length} production orders from manufacturing orders`);
      
      res.json(enrichedOrders);
    } catch (error: any) {
      console.error('Failed to fetch production orders after 3 attempts:', error);
      res.status(500).json({ 
        message: "Failed to fetch production orders", 
        error: error?.message || 'Unknown error',
        details: 'The request to fetch production orders timed out or failed after multiple attempts'
      });
    }
  });

  // ===========================
  // ASSIGNMENTS ROUTE - OPTIMIZED VERSION
  // ===========================
  app.get("/api/assignments", isAuthenticated, async (req: Request, res: Response) => {
    try {
      // Fetch production orders from Fulfil
      const fulfilService = new FulfilCurrentService();
      const productionOrdersData = await fulfilService.getCurrentProductionOrders();
      
      // Create work order map
      const workOrderMap = new Map<number, any>();
      productionOrdersData.forEach(po => {
        if (po.workOrders) {
          po.workOrders.forEach((wo: any) => {
            const woId = Number(wo.id);
            workOrderMap.set(woId, {
              workOrder: wo,
              productionOrder: po
            });
          });
        }
      });

      // Get all assignments
      const assignments = await db
        .select()
        .from(workOrderAssignments)
        .where(eq(workOrderAssignments.isActive, true));

      // Get dashboard production order IDs
      const dashboardProductionOrderIds: number[] = [];
      workOrderMap.forEach((data) => {
        if (data.productionOrder?.id) {
          dashboardProductionOrderIds.push(data.productionOrder.id);
        }
      });
      
      const uniqueProductionOrderIds = [...new Set(dashboardProductionOrderIds)];
      
      // Get finished work order IDs from dashboard
      const finishedWorkOrderIds = new Set<number>();
      workOrderMap.forEach((workOrderData, workOrderId) => {
        if (workOrderData.workOrder.state === 'finished' || workOrderData.workOrder.state === 'done') {
          finishedWorkOrderIds.add(workOrderId);
        }
      });
      
      // Get work cycles for finished work orders on dashboard
      const completedCycles = await db
        .select({
          operatorName: workCycles.work_cycles_operator_rec_name,
          productionId: workCycles.work_production_id,
          duration: workCycles.work_cycles_duration,
          workOrderId: workCycles.work_id
        })
        .from(workCycles)
        .where(
          and(
            gt(workCycles.work_cycles_duration, 0),
            isNotNull(workCycles.work_cycles_operator_rec_name),
            inArray(workCycles.work_production_id, uniqueProductionOrderIds)
          )
        );
      
      // Filter to only finished work orders and calculate completed hours
      const finishedWorkOrderCycles = completedCycles.filter(cycle => {
        if (!cycle.workOrderId) return false;
        return finishedWorkOrderIds.has(Number(cycle.workOrderId));
      });
      
      const completedHoursByOperator = new Map<string, number>();
      finishedWorkOrderCycles.forEach(cycle => {
        if (cycle.operatorName && cycle.duration && cycle.duration > 0) {
          const hours = cycle.duration / 3600;
          const currentHours = completedHoursByOperator.get(cycle.operatorName) || 0;
          completedHoursByOperator.set(cycle.operatorName, currentHours + hours);
        }
      });
      
      // Get operator mapping
      const allOperators = await db.select().from(operators);
      const operatorIdToName = new Map<number, string>();
      allOperators.forEach(op => operatorIdToName.set(op.id, op.name));
      
      // Enrich assignments with work order data
      const enrichedAssignments = await Promise.all(assignments.map(async (assignment) => {
        const workOrderData = workOrderMap.get(assignment.workOrderId);
        
        if (!workOrderData) {
          return null;
        }
        
        const { workOrder, productionOrder } = workOrderData;
        const operatorName = operatorIdToName.get(assignment.operatorId) || 'Unknown';
        const operatorCompletedHours = completedHoursByOperator.get(operatorName) || 0;
        
        return {
          ...assignment,
          workCenter: workOrder.workCenter || 'Unknown',
          operation: workOrder.operation || 'Unknown',
          routing: productionOrder.routing || 'Unknown',
          productRouting: productionOrder.routing || 'Unknown',
          quantity: workOrder.quantity || productionOrder.quantity || 0,
          productionOrderId: productionOrder.id,
          productName: productionOrder.productName || 'Unknown',
          moNumber: productionOrder.moNumber || 'Unknown',
          estimatedHours: assignment.estimatedHours || 0,
          completedHours: operatorCompletedHours,
          workOrderState: workOrder.state || 'unknown',
          workCycles: 0
        };
      }));
      
      // Filter out null assignments
      const validAssignments = enrichedAssignments.filter(a => a !== null);
      
      res.json({ assignments: validAssignments });
    } catch (error) {
      console.error("Error fetching work order assignments:", error);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  // ===========================
  // WORK ORDERS ROUTES
  // ===========================
  app.post("/api/work-orders/assign-operator", isAuthenticated, async (req, res) => {
    try {
      const { workOrderId, operatorId, estimatedHours } = req.body;
      
      if (!workOrderId || !operatorId) {
        return res.status(400).json({ 
          message: "Work order ID and operator ID are required" 
        });
      }

      // Deactivate any existing assignments for this work order
      await db
        .update(workOrderAssignments)
        .set({ isActive: false })
        .where(eq(workOrderAssignments.workOrderId, workOrderId));

      // Create new assignment
      const [newAssignment] = await db
        .insert(workOrderAssignments)
        .values({
          workOrderId,
          operatorId,
          assignedBy: req.user?.claims?.sub || req.user?.id || 'dashboard',
          isActive: true,
          isAutoAssigned: false,
          estimatedHours: estimatedHours || null
        })
        .returning();

      res.json({ 
        message: "Operator assigned successfully", 
        assignment: newAssignment 
      });
    } catch (error) {
      console.error("Error assigning operator:", error);
      res.status(500).json({ message: "Failed to assign operator" });
    }
  });

  // ===========================
  // OPERATORS ROUTES
  // ===========================
  app.get("/api/operators", isAuthenticated, async (req, res) => {
    try {
      const allOperators = await db
        .select()
        .from(operators)
        .orderBy(operators.name);
      
      res.json({ operators: allOperators });
    } catch (error) {
      console.error("Error fetching operators:", error);
      res.status(500).json({ message: "Failed to fetch operators" });
    }
  });

  app.get("/api/operators/qualified", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { workCenter, routing } = req.query;
      
      if (!workCenter || !routing) {
        return res.status(400).json({ 
          message: "Work center and routing are required" 
        });
      }

      // Get active operators
      const activeOperators = await db
        .select()
        .from(operators)
        .where(eq(operators.isActive, true));

      // Get UPH data
      const uphDataRecords = await db.select().from(uphData);
      
      // Find operators with UPH data for this work center/routing
      const qualifiedOperators = activeOperators.filter(operator => {
        return uphDataRecords.some(record => 
          record.operatorName === operator.name &&
          record.workCenter === workCenter &&
          record.productRouting === routing
        );
      });

      // Map to include UPH data
      const operatorsWithUph = qualifiedOperators.map(operator => {
        const uphRecord = uphDataRecords.find(record => 
          record.operatorName === operator.name &&
          record.workCenter === workCenter &&
          record.productRouting === routing
        );
        
        return {
          ...operator,
          uph: uphRecord?.uph || 0,
          observationCount: uphRecord?.observationCount || 0
        };
      });

      res.json({ operators: operatorsWithUph });
    } catch (error) {
      console.error("Error fetching qualified operators:", error);
      res.status(500).json({ message: "Failed to fetch qualified operators" });
    }
  });

  app.patch("/api/operators/:id", isAuthenticated, async (req, res) => {
    try {
      const operatorId = parseInt(req.params.id);
      const updates = req.body;
      
      const [updated] = await db
        .update(operators)
        .set(updates)
        .where(eq(operators.id, operatorId))
        .returning();
      
      res.json({ operator: updated });
    } catch (error) {
      console.error("Error updating operator:", error);
      res.status(500).json({ message: "Failed to update operator" });
    }
  });

  // ===========================
  // UPH DATA ROUTES
  // ===========================
  app.get("/api/uph-data", async (req, res) => {
    try {
      const data = await db
        .select()
        .from(uphData)
        .orderBy(uphData.operatorName, uphData.workCenter, uphData.productRouting);
      
      res.json({ uphData: data });
    } catch (error) {
      console.error("Error fetching UPH data:", error);
      res.status(500).json({ message: "Failed to fetch UPH data" });
    }
  });

  app.get("/api/uph/table-data", isAuthenticated, async (req, res) => {
    try {
      const uphValues = await calculateCoreUph();
      
      const formattedData = uphValues.map(item => ({
        operatorName: item.operatorName,
        workCenter: item.workCenter,
        operation: '',
        productRouting: item.routing,
        uph: item.unitsPerHour,
        observationCount: item.observations,
        totalQuantity: 0,
        totalDurationHours: 0
      }));
      
      res.json({ uphData: formattedData });
    } catch (error) {
      console.error("Error fetching UPH table data:", error);
      res.status(500).json({ message: "Failed to fetch UPH table data" });
    }
  });

  app.get("/api/uph/calculation-details", isAuthenticated, async (req, res) => {
    try {
      const { operatorName, workCenter, routing } = req.query;
      
      if (!operatorName || !workCenter || !routing) {
        return res.status(400).json({ 
          message: "Operator name, work center, and routing are required" 
        });
      }

      const workCycleData = await db
        .select({
          moNumber: workCycles.work_production_number,
          productionId: workCycles.work_production_id,
          quantity: workCycles.work_production_quantity,
          duration: workCycles.work_cycles_duration,
          createDate: workCycles.work_production_create_date,
          workCenter: workCycles.work_cycles_work_center_rec_name,
          operation: workCycles.work_operation_rec_name
        })
        .from(workCycles)
        .where(
          and(
            eq(workCycles.work_cycles_operator_rec_name, operatorName as string),
            eq(workCycles.work_cycles_work_center_rec_name, workCenter as string),
            eq(workCycles.work_production_routing_rec_name, routing as string),
            gt(workCycles.work_cycles_duration, 0)
          )
        );

      // Group by MO and calculate UPH for each
      const moGroups = new Map<string, any>();
      
      workCycleData.forEach(cycle => {
        const moKey = cycle.moNumber || `MO-${cycle.productionId}`;
        
        if (!moGroups.has(moKey)) {
          moGroups.set(moKey, {
            moNumber: moKey,
            quantity: cycle.quantity || 0,
            totalDuration: 0,
            cycles: []
          });
        }
        
        const group = moGroups.get(moKey);
        group.totalDuration += (cycle.duration || 0);
        group.cycles.push(cycle);
      });

      const details = Array.from(moGroups.values()).map(mo => ({
        moNumber: mo.moNumber,
        productionId: mo.cycles[0]?.productionId,
        quantity: mo.quantity,
        duration: mo.totalDuration / 3600,
        uph: mo.totalDuration > 0 ? (mo.quantity / (mo.totalDuration / 3600)) : 0,
        createDate: mo.cycles[0]?.createDate,
        workCenter: mo.cycles[0]?.workCenter,
        operations: [...new Set(mo.cycles.map((c: any) => c.operation).filter(Boolean))].join(', ')
      }));

      res.json({ details });
    } catch (error) {
      console.error("Error fetching UPH calculation details:", error);
      res.status(500).json({ message: "Failed to fetch calculation details" });
    }
  });

  app.post("/api/uph/calculate", isAuthenticated, async (req, res) => {
    try {
      console.log('Starting UPH calculation...');
      const result = await calculateCoreUph();
      console.log(`UPH calculation completed: ${result.length} values calculated`);
      
      res.json({ 
        message: `Successfully calculated ${result.length} UPH values`,
        count: result.length 
      });
    } catch (error) {
      console.error("Error calculating UPH:", error);
      res.status(500).json({ message: "Failed to calculate UPH" });
    }
  });

  // ===========================
  // FULFIL INTEGRATION ROUTES
  // ===========================
  app.get("/api/fulfil/settings", isAuthenticated, async (req, res) => {
    try {
      // Return default settings since fulfilSettings table doesn't exist
      res.json({ 
        apiKey: '', 
        subdomain: 'apc',
        syncInterval: 300000,
        isActive: false 
      });
    } catch (error) {
      console.error("Error fetching Fulfil settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.get("/api/fulfil/import-status", isAuthenticated, async (req, res) => {
    res.json({ 
      isImporting: false, 
      isCalculatingUph: false 
    });
  });

  app.post("/api/fulfil/upload-work-cycles-csv", isAuthenticated, async (req, res) => {
    try {
      res.json({ 
        message: "CSV upload endpoint - implementation pending",
        success: false 
      });
    } catch (error) {
      console.error("Error uploading CSV:", error);
      res.status(500).json({ message: "Failed to upload CSV" });
    }
  });

  // ===========================
  // SMART BULK ASSIGNMENT ROUTES
  // ===========================
  app.post("/api/assignments/smart-bulk", isAuthenticated, async (req, res) => {
    try {
      const { workOrderIds, operatorId } = req.body;
      
      if (!workOrderIds || !Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ 
          message: "Work order IDs array is required" 
        });
      }

      if (!operatorId) {
        return res.status(400).json({ 
          message: "Operator ID is required" 
        });
      }

      // Deactivate existing assignments
      await db
        .update(workOrderAssignments)
        .set({ isActive: false })
        .where(inArray(workOrderAssignments.workOrderId, workOrderIds));

      // Create new assignments
      const newAssignments = await db
        .insert(workOrderAssignments)
        .values(
          workOrderIds.map(workOrderId => ({
            workOrderId,
            operatorId,
            assignedBy: req.user?.claims?.sub || req.user?.id || 'bulk-assignment',
            isActive: true,
            isAutoAssigned: false
          }))
        )
        .returning();

      res.json({ 
        message: `Successfully assigned ${newAssignments.length} work orders`,
        assignments: newAssignments 
      });
    } catch (error) {
      console.error("Error in smart bulk assignment:", error);
      res.status(500).json({ message: "Failed to assign work orders" });
    }
  });

  // ===========================
  // AUTO-ASSIGN ROUTES
  // ===========================
  app.post("/api/auto-assign", isAuthenticated, async (req, res) => {
    try {
      const { productionOrderIds } = req.body;
      
      // Simple rule-based auto-assignment
      const fulfilService = new FulfilCurrentService();
      const productionOrdersData = await fulfilService.getCurrentProductionOrders();
      
      // Filter to requested production orders
      const targetOrders = productionOrdersData.filter(po => 
        productionOrderIds.includes(po.id)
      );

      let totalAssigned = 0;
      const assignments: any[] = [];

      // Get operators and UPH data
      const activeOperators = await db
        .select()
        .from(operators)
        .where(eq(operators.isActive, true));
      
      const uphDataRecords = await db.select().from(uphData);

      for (const po of targetOrders) {
        if (po.workOrders) {
          for (const wo of po.workOrders) {
            // Skip if already assigned
            const existing = await db
              .select()
              .from(workOrderAssignments)
              .where(
                and(
                  eq(workOrderAssignments.workOrderId, wo.id),
                  eq(workOrderAssignments.isActive, true)
                )
              )
              .limit(1);
            
            if (existing.length > 0) continue;

            // Find best operator based on UPH
            const qualifiedOps = activeOperators.filter(op => {
              return uphDataRecords.some(uph => 
                uph.operatorName === op.name &&
                uph.workCenter === wo.workCenter &&
                uph.productRouting === po.routing
              );
            });

            if (qualifiedOps.length > 0) {
              // Sort by UPH (highest first)
              const opsWithUph = qualifiedOps.map(op => {
                const uphRecord = uphDataRecords.find(uph => 
                  uph.operatorName === op.name &&
                  uph.workCenter === wo.workCenter &&
                  uph.productRouting === po.routing
                );
                return { operator: op, uph: uphRecord?.uph || 0 };
              });

              opsWithUph.sort((a, b) => b.uph - a.uph);
              const bestOperator = opsWithUph[0].operator;

              // Create assignment
              const [assignment] = await db
                .insert(workOrderAssignments)
                .values({
                  workOrderId: wo.id,
                  operatorId: bestOperator.id,
                  assignedBy: 'auto-assign',
                  isActive: true,
                  isAutoAssigned: true,
                  autoAssignReason: `Best UPH: ${opsWithUph[0].uph.toFixed(1)} units/hour`,
                  autoAssignConfidence: 0.8
                })
                .returning();

              assignments.push({
                ...assignment,
                operatorName: bestOperator.name,
                workCenter: wo.workCenter,
                moNumber: po.moNumber
              });
              totalAssigned++;
            }
          }
        }
      }

      res.json({
        success: true,
        message: `Successfully assigned ${totalAssigned} work orders`,
        assignmentsCount: totalAssigned,
        assignments
      });
    } catch (error) {
      console.error("Error in auto-assign:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to auto-assign work orders",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ===========================
  // SLACK INTEGRATION ROUTES
  // ===========================
  app.post("/api/slack/send-workload", isAuthenticated, async (req, res) => {
    try {
      const { operatorId, message } = req.body;
      
      // TODO: Implement Slack message sending
      res.json({ 
        success: true, 
        message: "Slack integration pending" 
      });
    } catch (error) {
      console.error("Error sending Slack message:", error);
      res.status(500).json({ message: "Failed to send Slack message" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}