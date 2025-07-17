import { 
  users, 
  productionOrders, 
  workOrders, 
  operators, 
  uphData, 
  batches,
  historicalUph,
  workCycles,
  activeWorkOrders,
  type User, 
  type InsertUser,
  type ProductionOrder,
  type InsertProductionOrder,
  type WorkOrder,
  type InsertWorkOrder,
  type Operator,
  type InsertOperator,
  type UphData,
  type InsertUphData,
  type Batch,
  type InsertBatch,
  type ActiveWorkOrder,
  type InsertActiveWorkOrder
} from "@shared/schema";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Production Order methods
  getProductionOrders(statusFilter?: string[], excludeCompleted?: boolean): Promise<ProductionOrder[]>;
  getProductionOrder(id: number): Promise<ProductionOrder | undefined>;
  createProductionOrder(po: InsertProductionOrder): Promise<ProductionOrder>;
  updateProductionOrder(id: number, updates: Partial<ProductionOrder>): Promise<ProductionOrder | undefined>;
  
  // Work Order methods
  getWorkOrders(): Promise<WorkOrder[]>;
  getWorkOrdersByProductionOrder(productionOrderId: number): Promise<WorkOrder[]>;
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  createWorkOrder(wo: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: number, updates: Partial<WorkOrder>): Promise<WorkOrder | undefined>;
  
  // Operator methods
  getOperators(activeOnly?: boolean): Promise<Operator[]>;
  getOperator(id: number): Promise<Operator | undefined>;
  createOperator(operator: InsertOperator): Promise<Operator>;
  updateOperator(id: number, updates: Partial<Operator>): Promise<Operator | undefined>;
  getAvailableOperators(workCenter: string, operation: string, routing: string): Promise<Operator[]>;
  
  // UPH Data methods
  getUphData(operatorId?: number, workCenter?: string, operation?: string, dateRange?: string, startDate?: string, endDate?: string): Promise<UphData[]>;
  getOperatorUph(operatorId: number, workCenter: string, operation: string, routing: string): Promise<UphData | undefined>;
  createUphData(uph: InsertUphData): Promise<UphData>;
  updateUphData(id: number, updates: Partial<UphData>): Promise<UphData | undefined>;
  
  // Batch methods
  getBatches(): Promise<Batch[]>;
  getBatch(id: number): Promise<Batch | undefined>;
  createBatch(batch: InsertBatch): Promise<Batch>;
  updateBatch(id: number, updates: Partial<Batch>): Promise<Batch | undefined>;
  assignProductionOrdersToBatch(productionOrderIds: number[], batchId: string): Promise<void>;

  // Active Work Orders
  upsertActiveWorkOrder(workOrder: InsertActiveWorkOrder): Promise<ActiveWorkOrder>;
  getActiveWorkOrders(states?: string[]): Promise<ActiveWorkOrder[]>;
  getActiveWorkOrderById(id: number): Promise<ActiveWorkOrder | undefined>;
  deleteActiveWorkOrdersByState(state: string): Promise<void>;
  deleteActiveWorkOrderById(id: number): Promise<void>;
  updateActiveWorkOrderSyncTime(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private productionOrders: Map<number, ProductionOrder>;
  private workOrders: Map<number, WorkOrder>;
  private operators: Map<number, Operator>;
  private uphData: Map<number, UphData>;
  private batches: Map<number, Batch>;
  private currentId: number;

  constructor() {
    this.users = new Map();
    this.productionOrders = new Map();
    this.workOrders = new Map();
    this.operators = new Map();
    this.uphData = new Map();
    this.batches = new Map();
    this.currentId = 1;
    
    this.initializeTestData();
  }

  private initializeTestData() {
    // Create test operators
    const testOperators = [
      { name: "John Smith", workCenters: ["Cutting"], operations: ["Cut"], routings: ["Lifetime Leash", "Lifetime Harness", "Lifetime Pro Collar"], availableHours: 40 },
      { name: "Maria Garcia", workCenters: ["Assembly"], operations: ["Assembly"], routings: ["Lifetime Leash", "Lifetime Harness", "Fi Snap"], availableHours: 40 },
      { name: "David Chen", workCenters: ["Cutting"], operations: ["Cut"], routings: ["Lifetime Lite Leash", "Fi Snap", "Lifetime Bowl"], availableHours: 40 },
      { name: "Sarah Wilson", workCenters: ["Packaging"], operations: ["Package"], routings: ["Lifetime Leash", "Lifetime Pro Collar", "Lifetime Bowl"], availableHours: 40 },
      { name: "Mike Johnson", workCenters: ["Assembly"], operations: ["Assembly"], routings: ["Lifetime Harness", "Lifetime Pro Collar", "Lifetime Lite Leash"], availableHours: 40 },
      { name: "Lisa Brown", workCenters: ["Assembly"], operations: ["Assembly"], routings: ["Lifetime Bowl", "Fi Snap", "Lifetime Leash"], availableHours: 40 },
      { name: "Tom Davis", workCenters: ["Packaging"], operations: ["Package"], routings: ["Lifetime Harness", "Lifetime Lite Leash", "Fi Snap"], availableHours: 40 },
      { name: "Anna Lee", workCenters: ["Packaging"], operations: ["Package"], routings: ["Lifetime Pro Collar", "Lifetime Bowl", "Lifetime Leash"], availableHours: 40 },
      { name: "Carlos Rodriguez", workCenters: ["Packaging"], operations: ["Package"], routings: ["Lifetime Harness", "Lifetime Lite Leash", "Lifetime Bowl"], availableHours: 40 },
    ];

    testOperators.forEach(op => {
      const operator = { ...op, id: this.currentId++, fulfilId: null, isActive: true, uphCalculationWindow: 30, slackUserId: null, lastActiveDate: new Date() };
      this.operators.set(operator.id, operator);
    });

    // Create UPH data
    const uphTestData = [
      { operatorId: 1, workCenter: "Cutting", operation: "Cut", routing: "Lifetime Leash", unitsPerHour: 18 },
      { operatorId: 1, workCenter: "Cutting", operation: "Cut", routing: "Lifetime Harness", unitsPerHour: 15 },
      { operatorId: 1, workCenter: "Cutting", operation: "Cut", routing: "Lifetime Pro Collar", unitsPerHour: 22 },
      { operatorId: 2, workCenter: "Assembly", operation: "Assembly", routing: "Lifetime Leash", unitsPerHour: 12 },
      { operatorId: 2, workCenter: "Assembly", operation: "Assembly", routing: "Lifetime Harness", unitsPerHour: 10 },
      { operatorId: 2, workCenter: "Assembly", operation: "Assembly", routing: "Fi Snap", unitsPerHour: 16 },
      { operatorId: 3, workCenter: "Cutting", operation: "Cut", routing: "Lifetime Lite Leash", unitsPerHour: 20 },
      { operatorId: 3, workCenter: "Cutting", operation: "Cut", routing: "Fi Snap", unitsPerHour: 25 },
      { operatorId: 3, workCenter: "Cutting", operation: "Cut", routing: "Lifetime Bowl", unitsPerHour: 30 },
      { operatorId: 4, workCenter: "Packaging", operation: "Package", routing: "Lifetime Leash", unitsPerHour: 25 },
      { operatorId: 4, workCenter: "Packaging", operation: "Package", routing: "Lifetime Pro Collar", unitsPerHour: 28 },
      { operatorId: 4, workCenter: "Packaging", operation: "Package", routing: "Lifetime Bowl", unitsPerHour: 35 },
      { operatorId: 5, workCenter: "Assembly", operation: "Assembly", routing: "Lifetime Harness", unitsPerHour: 14 },
      { operatorId: 5, workCenter: "Assembly", operation: "Assembly", routing: "Lifetime Pro Collar", unitsPerHour: 11 },
      { operatorId: 5, workCenter: "Assembly", operation: "Assembly", routing: "Lifetime Lite Leash", unitsPerHour: 18 },
    ];

    uphTestData.forEach(uph => {
      const operator = this.operators.get(uph.operatorId);
      const uphRecord = { 
        id: this.currentId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        operatorId: uph.operatorId,
        operatorName: operator?.name || 'Unknown',
        workCenter: uph.workCenter,
        operation: uph.operation,
        productRouting: uph.routing,
        uph: uph.unitsPerHour,
        unitsPerHour: uph.unitsPerHour,
        observationCount: 10,
        calculationPeriod: 30,
        metaId: null,
        totalDurationHours: 10,
        totalQuantity: uph.unitsPerHour * 10,
        dataSource: 'manual' as const
      };
      this.uphData.set(uphRecord.id, uphRecord);
    });

    // Create test production orders
    const testPOs = [
      { moNumber: "MO-2024-001", productName: "Lifetime Leash - Black", quantity: 150, status: "Assigned", dueDate: new Date("2024-01-05"), batchId: "batch-a", priority: "High" },
      { moNumber: "MO-2024-002", productName: "Lifetime Harness - Blue", quantity: 100, status: "Waiting", dueDate: new Date("2024-01-05"), batchId: "batch-a", priority: "High" },
      { moNumber: "MO-2024-003", productName: "Lifetime Pro Collar - Red", quantity: 120, status: "Assigned", dueDate: new Date("2024-01-05"), batchId: "batch-a", priority: "High" },
      { moNumber: "MO-2024-004", productName: "Fi Snap - Premium", quantity: 75, status: "Requests", dueDate: new Date("2024-01-08"), batchId: null, priority: "Normal" },
      { moNumber: "MO-2024-005", productName: "Lifetime Lite Leash - Green", quantity: 200, status: "Draft", dueDate: new Date("2024-01-10"), batchId: null, priority: "Normal" },
      { moNumber: "MO-2024-006", productName: "Lifetime Bowl - Stainless", quantity: 50, status: "Waiting", dueDate: new Date("2024-01-12"), batchId: null, priority: "Low" },
    ];

    testPOs.forEach(po => {
      // Determine routing based on product name
      let routing = "Lifetime Leash";
      if (po.productName.includes("Harness")) routing = "Lifetime Harness";
      else if (po.productName.includes("Pro Collar")) routing = "Lifetime Pro Collar";
      else if (po.productName.includes("Fi Snap")) routing = "Fi Snap";
      else if (po.productName.includes("Lite Leash")) routing = "Lifetime Lite Leash";
      else if (po.productName.includes("Bowl")) routing = "Lifetime Bowl";
      
      const productionOrder = { 
        ...po, 
        id: this.currentId++, 
        fulfilId: null,
        routing: routing,
        rec_name: po.moNumber,
        state: po.status.toLowerCase(),
        planned_date: po.dueDate.toISOString().split('T')[0],
        create_date: new Date().toISOString(),
        product_code: null,
        createdAt: new Date()
      };
      this.productionOrders.set(productionOrder.id, productionOrder);

      // Create work orders for each production order
      const workOrdersData = [
        { workCenter: "Cutting", operation: "Cut", routing: routing, sequence: 1 },
        { workCenter: "Assembly", operation: "Assembly", routing: routing, sequence: 2 },
        { workCenter: "Packaging", operation: "Package", routing: routing, sequence: 3 },
      ];

      workOrdersData.forEach(wo => {
        const workOrder = {
          ...wo,
          id: this.currentId++,
          productionOrderId: productionOrder.id,
          assignedOperatorId: null,
          estimatedHours: null,
          actualHours: null,
          status: "Pending",
          fulfilId: null,
          type: null,
          priority: po.priority,
          rec_name: `WO${this.currentId} | ${wo.operation} | ${po.moNumber}`,
          state: "waiting",
          planned_date: po.dueDate.toISOString().split('T')[0],
          create_date: new Date().toISOString(),
          write_date: new Date().toISOString(),
          quantityDone: 0,
          quantity: po.quantity,
          createdBy: null,
          operatorName: null,
          operatorFullName: null,
          moNumber: po.moNumber,
          productCode: null,
          productName: po.productName,
          assignedByAi: false,
          aiConfidence: null,
          aiReasoning: null,
          work_center: wo.workCenter,
          cycleIds: [],
          totalCycleDuration: null,
          quantity_done: 0,
          production: productionOrder.id,
          production_display_name: po.moNumber,
          operation_display_name: wo.operation,
          work_center_display_name: wo.workCenter,
          operationId: null,
          operator: null,
          cost: null,
          workCenterName: wo.workCenter,
          operationName: wo.operation
        };
        this.workOrders.set(workOrder.id, workOrder);
      });
    });

    // Create test batches
    const testBatches = [
      { name: "Batch A - High Priority", description: "Urgent orders for January delivery", priority: "High", dueDate: new Date("2024-01-05"), status: "Planning", totalEstimatedHours: 45.2 },
    ];

    testBatches.forEach(batch => {
      const batchRecord = { ...batch, id: this.currentId++, createdAt: new Date() };
      this.batches.set(batchRecord.id, batchRecord);
    });
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Production Order methods
  async getProductionOrders(statusFilter?: string[]): Promise<ProductionOrder[]> {
    const orders = Array.from(this.productionOrders.values());
    if (statusFilter && statusFilter.length > 0) {
      return orders.filter(order => statusFilter.includes(order.status));
    }
    return orders;
  }

  async getProductionOrder(id: number): Promise<ProductionOrder | undefined> {
    return this.productionOrders.get(id);
  }

  async createProductionOrder(po: InsertProductionOrder): Promise<ProductionOrder> {
    const id = this.currentId++;
    const productionOrder: ProductionOrder = { 
      ...po, 
      id,
      createdAt: new Date(),
      routing: po.routing ?? null,
      dueDate: po.dueDate ?? null,
      batchId: po.batchId ?? null,
      priority: po.priority ?? null,
      fulfilId: po.fulfilId ?? null,
      rec_name: po.rec_name ?? null,
      state: po.state ?? null,
      planned_date: po.planned_date ?? null,
      create_date: po.create_date ?? null,
      product_code: po.product_code ?? null
    };
    this.productionOrders.set(id, productionOrder);
    return productionOrder;
  }

  async updateProductionOrder(id: number, updates: Partial<ProductionOrder>): Promise<ProductionOrder | undefined> {
    const existing = this.productionOrders.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.productionOrders.set(id, updated);
    return updated;
  }

  // Work Order methods
  async getWorkOrders(): Promise<WorkOrder[]> {
    return Array.from(this.workOrders.values())
      .sort((a, b) => a.id - b.id);
  }

  async getWorkOrdersByProductionOrder(productionOrderId: number): Promise<WorkOrder[]> {
    return Array.from(this.workOrders.values())
      .filter(wo => wo.productionOrderId === productionOrderId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    return this.workOrders.get(id);
  }

  async createWorkOrder(wo: InsertWorkOrder): Promise<WorkOrder> {
    const id = this.currentId++;
    const workOrder: WorkOrder = { 
      ...wo, 
      id,
      // Handle all nullable fields
      type: wo.type ?? null,
      status: wo.status ?? null,
      priority: wo.priority ?? null,
      fulfilId: wo.fulfilId ?? null,
      rec_name: wo.rec_name ?? null,
      state: wo.state ?? null,
      planned_date: wo.planned_date ?? null,
      create_date: wo.create_date ?? null,
      cycleIds: wo.cycleIds ?? [],
      totalCycleDuration: wo.totalCycleDuration ?? null,
      quantity_done: wo.quantity_done ?? null,
      production: wo.production ?? null,
      estimatedHours: wo.estimatedHours ?? null,
      actualHours: wo.actualHours ?? null,
      assignedOperatorId: wo.assignedOperatorId ?? null,
      operatorName: wo.operatorName ?? null,

      operationId: wo.operationId ?? null,
      operator: wo.operator ?? null,
      cost: wo.cost ?? null,
      workCenterName: wo.workCenterName ?? null,
      operationName: wo.operationName ?? null,
      work_center: wo.work_center ?? null,
      quantity: wo.quantity ?? null
    };
    this.workOrders.set(id, workOrder);
    return workOrder;
  }

  async updateWorkOrder(id: number, updates: Partial<WorkOrder>): Promise<WorkOrder | undefined> {
    const existing = this.workOrders.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.workOrders.set(id, updated);
    return updated;
  }

  // Operator methods
  async getOperators(activeOnly = true): Promise<Operator[]> {
    const operators = Array.from(this.operators.values());
    return activeOnly ? operators.filter(op => op.isActive) : operators;
  }

  async getOperator(id: number): Promise<Operator | undefined> {
    return this.operators.get(id);
  }

  async createOperator(operator: InsertOperator): Promise<Operator> {
    const id = this.currentId++;
    const newOperator: Operator = { 
      ...operator, 
      id, 
      lastActiveDate: new Date(),
      fulfilId: operator.fulfilId ?? null,
      slackUserId: operator.slackUserId ?? null,
      availableHours: operator.availableHours ?? null,
      workCenters: operator.workCenters ?? null,
      routings: operator.routings ?? null,
      operations: operator.operations ?? null,
      isActive: operator.isActive ?? true,
      uphCalculationWindow: operator.uphCalculationWindow ?? null
    };
    this.operators.set(id, newOperator);
    return newOperator;
  }

  async updateOperator(id: number, updates: Partial<Operator>): Promise<Operator | undefined> {
    const existing = this.operators.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.operators.set(id, updated);
    return updated;
  }

  async getAvailableOperators(workCenter: string, operation: string, routing: string): Promise<Operator[]> {
    return Array.from(this.operators.values()).filter(op => 
      op.isActive &&
      op.workCenters?.includes(workCenter) &&
      op.operations?.includes(operation) &&
      op.routings?.includes(routing)
    );
  }

  // UPH Data methods
  async getUphData(operatorId?: number, workCenter?: string, operation?: string): Promise<UphData[]> {
    let data = Array.from(this.uphData.values());
    
    if (operatorId) data = data.filter(uph => uph.operatorId === operatorId);
    if (workCenter) data = data.filter(uph => uph.workCenter === workCenter);
    if (operation) data = data.filter(uph => uph.operation === operation);
    
    return data;
  }

  async getOperatorUph(operatorId: number, workCenter: string, operation: string, routing: string): Promise<UphData | undefined> {
    return Array.from(this.uphData.values()).find(uph => 
      uph.operatorId === operatorId &&
      uph.workCenter === workCenter &&
      uph.operation === operation &&
      uph.routing === routing
    );
  }

  async createUphData(uph: InsertUphData): Promise<UphData> {
    const id = this.currentId++;
    const uphRecord: UphData = { ...uph, id, lastUpdated: new Date() };
    this.uphData.set(id, uphRecord);
    return uphRecord;
  }

  async updateUphData(id: number, updates: Partial<UphData>): Promise<UphData | undefined> {
    const existing = this.uphData.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates, lastUpdated: new Date() };
    this.uphData.set(id, updated);
    return updated;
  }

  // Batch methods
  async getBatches(): Promise<Batch[]> {
    return Array.from(this.batches.values());
  }

  async getBatch(id: number): Promise<Batch | undefined> {
    return this.batches.get(id);
  }

  async createBatch(batch: InsertBatch): Promise<Batch> {
    const id = this.currentId++;
    const newBatch: Batch = { 
      ...batch, 
      id, 
      createdAt: new Date(),
      status: batch.status ?? null,
      dueDate: batch.dueDate ?? null,
      priority: batch.priority ?? null,
      description: batch.description ?? null,
      totalEstimatedHours: batch.totalEstimatedHours ?? null
    };
    this.batches.set(id, newBatch);
    return newBatch;
  }

  async updateBatch(id: number, updates: Partial<Batch>): Promise<Batch | undefined> {
    const existing = this.batches.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.batches.set(id, updated);
    return updated;
  }

  async assignProductionOrdersToBatch(productionOrderIds: number[], batchId: string): Promise<void> {
    productionOrderIds.forEach(id => {
      const po = this.productionOrders.get(id);
      if (po) {
        const updated = { ...po, batchId };
        this.productionOrders.set(id, updated);
      }
    });
  }

  // Active Work Orders (MemStorage implementation - not used in production)
  private activeWorkOrders: Map<number, ActiveWorkOrder> = new Map();
  
  async upsertActiveWorkOrder(workOrder: InsertActiveWorkOrder): Promise<ActiveWorkOrder> {
    const id = workOrder.id!;
    const existing = this.activeWorkOrders.get(id);
    const now = new Date();
    
    if (existing) {
      const updated = { ...existing, ...workOrder, updatedAt: now };
      this.activeWorkOrders.set(id, updated);
      return updated;
    } else {
      const newOrder: ActiveWorkOrder = {
        ...workOrder,
        id,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now
      } as ActiveWorkOrder;
      this.activeWorkOrders.set(id, newOrder);
      return newOrder;
    }
  }

  async getActiveWorkOrders(states?: string[]): Promise<ActiveWorkOrder[]> {
    const all = Array.from(this.activeWorkOrders.values());
    if (states && states.length > 0) {
      return all.filter(order => states.includes(order.state));
    }
    return all;
  }

  async getActiveWorkOrderById(id: number): Promise<ActiveWorkOrder | undefined> {
    return this.activeWorkOrders.get(id);
  }

  async deleteActiveWorkOrdersByState(state: string): Promise<void> {
    const toDelete = Array.from(this.activeWorkOrders.entries())
      .filter(([_, order]) => order.state === state)
      .map(([id]) => id);
    
    toDelete.forEach(id => this.activeWorkOrders.delete(id));
  }

  async deleteActiveWorkOrderById(id: number): Promise<void> {
    this.activeWorkOrders.delete(id);
  }

  async updateActiveWorkOrderSyncTime(): Promise<void> {
    const now = new Date();
    this.activeWorkOrders.forEach((order, id) => {
      this.activeWorkOrders.set(id, { ...order, lastSyncedAt: now });
    });
  }
}

import { db } from "./db";
import { eq, and, inArray, not } from "drizzle-orm";

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getProductionOrders(statusFilter?: string[], excludeCompleted = true): Promise<ProductionOrder[]> {
    if (statusFilter && statusFilter.length > 0) {
      return await db.select().from(productionOrders).where(inArray(productionOrders.status, statusFilter));
    }
    
    // When no specific filter is applied, show all production orders (let frontend filter control this)
    return await db.select().from(productionOrders);
  }

  async getProductionOrder(id: number): Promise<ProductionOrder | undefined> {
    const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, id));
    return order || undefined;
  }

  async createProductionOrder(po: InsertProductionOrder): Promise<ProductionOrder> {
    const [order] = await db
      .insert(productionOrders)
      .values(po)
      .returning();
    return order;
  }

  async updateProductionOrder(id: number, updates: Partial<ProductionOrder>): Promise<ProductionOrder | undefined> {
    const [order] = await db
      .update(productionOrders)
      .set(updates)
      .where(eq(productionOrders.id, id))
      .returning();
    return order || undefined;
  }

  async getWorkOrders(): Promise<WorkOrder[]> {
    return await db.select().from(workOrders).orderBy(workOrders.id);
  }

  async getWorkOrdersByProductionOrder(productionOrderId: number): Promise<WorkOrder[]> {
    return await db.select().from(workOrders).where(eq(workOrders.productionOrderId, productionOrderId));
  }

  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    const [order] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    return order || undefined;
  }

  async createWorkOrder(wo: InsertWorkOrder): Promise<WorkOrder> {
    const [order] = await db
      .insert(workOrders)
      .values(wo)
      .returning();
    return order;
  }

  async updateWorkOrder(id: number, updates: Partial<WorkOrder>): Promise<WorkOrder | undefined> {
    const [order] = await db
      .update(workOrders)
      .set(updates)
      .where(eq(workOrders.id, id))
      .returning();
    return order || undefined;
  }

  async getOperators(activeOnly = true): Promise<Operator[]> {
    if (activeOnly) {
      return await db.select().from(operators).where(eq(operators.isActive, true));
    }
    return await db.select().from(operators);
  }

  async getOperator(id: number): Promise<Operator | undefined> {
    const [operator] = await db.select().from(operators).where(eq(operators.id, id));
    return operator || undefined;
  }

  async createOperator(operator: InsertOperator): Promise<Operator> {
    // Check if operator with same name already exists
    const existingOperator = await db.select()
      .from(operators)
      .where(eq(operators.name, operator.name))
      .limit(1);
    
    if (existingOperator.length > 0) {
      // Update existing operator instead of creating duplicate
      const [updatedOperator] = await db
        .update(operators)
        .set(operator)
        .where(eq(operators.id, existingOperator[0].id))
        .returning();
      return updatedOperator;
    }
    
    const [newOperator] = await db
      .insert(operators)
      .values(operator)
      .returning();
    return newOperator;
  }

  async updateOperator(id: number, updates: Partial<Operator>): Promise<Operator | undefined> {
    // Map frontend field names to database field names
    const fieldMapping: Record<string, string> = {
      'productRoutings': 'routings'
    };
    
    // Filter out undefined values and non-updateable fields, and map field names
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates)
        .filter(([key, value]) => value !== undefined && key !== 'id')
        .map(([key, value]) => [fieldMapping[key] || key, value])
    );
    
    if (Object.keys(filteredUpdates).length === 0) {
      // If no valid updates, just return the existing operator
      return this.getOperator(id);
    }

    console.log('Updating operator:', { id, originalUpdates: updates, filteredUpdates });

    try {
      const [operator] = await db
        .update(operators)
        .set(filteredUpdates)
        .where(eq(operators.id, id))
        .returning();
      return operator || undefined;
    } catch (error) {
      console.error('Error updating operator:', error);
      console.error('Filtered updates:', filteredUpdates);
      throw error;
    }
  }

  async getAvailableOperators(workCenter: string, operation: string, routing: string): Promise<Operator[]> {
    const allOperators = await this.getOperators(true);
    return allOperators.filter(op => 
      op.workCenters?.includes(workCenter) &&
      op.operations?.includes(operation) &&
      op.routings?.includes(routing)
    );
  }

  async getUphData(operatorId?: number, workCenter?: string, operation?: string, dateRange?: string, startDate?: string, endDate?: string): Promise<UphData[]> {
    // If date filtering is requested, recalculate UPH from work cycles with date filter
    if (dateRange || (startDate && endDate)) {
      return this.calculateUphWithDateFilter(operatorId, workCenter, operation, dateRange, startDate, endDate);
    }
    
    // Default behavior: return stored UPH data
    let query = db.select().from(uphData);
    
    const conditions = [];
    if (operatorId) conditions.push(eq(uphData.operatorId, operatorId));
    if (workCenter) conditions.push(eq(uphData.workCenter, workCenter));
    if (operation) conditions.push(eq(uphData.operation, operation));
    
    if (conditions.length > 0) {
      return await query.where(and(...conditions));
    }
    
    return await query;
  }

  async getOperatorUph(operatorId: number, workCenter: string, operation: string, routing: string): Promise<UphData | undefined> {
    const [uph] = await db.select().from(uphData).where(
      and(
        eq(uphData.operatorId, operatorId),
        eq(uphData.workCenter, workCenter),
        eq(uphData.operation, operation),
        eq(uphData.routing, routing)
      )
    );
    return uph || undefined;
  }

  async createUphData(uph: InsertUphData): Promise<UphData> {
    const [record] = await db
      .insert(uphData)
      .values(uph)
      .returning();
    return record;
  }

  async updateUphData(id: number, updates: Partial<UphData>): Promise<UphData | undefined> {
    const [record] = await db
      .update(uphData)
      .set(updates)
      .where(eq(uphData.id, id))
      .returning();
    return record || undefined;
  }

  async getBatches(): Promise<Batch[]> {
    return await db.select().from(batches);
  }

  async getBatch(id: number): Promise<Batch | undefined> {
    const [batch] = await db.select().from(batches).where(eq(batches.id, id));
    return batch || undefined;
  }

  async createBatch(batch: InsertBatch): Promise<Batch> {
    const [newBatch] = await db
      .insert(batches)
      .values(batch)
      .returning();
    return newBatch;
  }

  async updateBatch(id: number, updates: Partial<Batch>): Promise<Batch | undefined> {
    const [batch] = await db
      .update(batches)
      .set(updates)
      .where(eq(batches.id, id))
      .returning();
    return batch || undefined;
  }

  async assignProductionOrdersToBatch(productionOrderIds: number[], batchId: string): Promise<void> {
    await db
      .update(productionOrders)
      .set({ batchId })
      .where(inArray(productionOrders.id, productionOrderIds));
  }

  private async calculateUphWithDateFilter(operatorId?: number, workCenter?: string, operation?: string, dateRange?: string, startDate?: string, endDate?: string): Promise<UphData[]> {
    const { workCycles } = await import("../shared/schema.js");
    const { gte, lte, sql } = await import("drizzle-orm");

    // Calculate date range
    let dateStart: Date, dateEnd: Date = new Date();
    
    if (startDate && endDate) {
      dateStart = new Date(startDate);
      dateEnd = new Date(endDate);
    } else if (dateRange) {
      switch (dateRange) {
        case 'today':
          dateStart = new Date();
          dateStart.setHours(0, 0, 0, 0);
          break;
        case 'week':
          dateStart = new Date();
          dateStart.setDate(dateStart.getDate() - 7);
          break;
        case 'month':
          dateStart = new Date();
          dateStart.setMonth(dateStart.getMonth() - 1);
          break;
        case 'quarter':
          dateStart = new Date();
          dateStart.setMonth(dateStart.getMonth() - 3);
          break;
        case 'year':
          dateStart = new Date();
          dateStart.setFullYear(dateStart.getFullYear() - 1);
          break;
        default:
          dateStart = new Date();
          dateStart.setMonth(dateStart.getMonth() - 1); // Default to 1 month
      }
    } else {
      return []; // No date filter specified
    }

    // Query work cycles with date filter
    const conditions = [
      gte(workCycles.work_cycles_operator_write_date, dateStart),
      lte(workCycles.work_cycles_operator_write_date, dateEnd)
    ];

    if (operatorId) conditions.push(eq(workCycles.work_cycles_operator_id, operatorId));
    if (workCenter) conditions.push(sql`${workCycles.work_cycles_work_center_rec_name} = ${workCenter}`);

    const cycles = await db.select().from(workCycles).where(and(...conditions));

    // Group and calculate UPH from filtered cycles
    const uphResults: Map<string, {
      operatorId: number | null;
      workCenter: string;
      operation: string;
      routing: string;
      totalDuration: number;
      totalQuantity: number;
      observations: number;
    }> = new Map();

    for (const cycle of cycles) {
      if (!cycle.work_cycles_duration || cycle.work_cycles_duration < 120) continue; // Skip cycles < 2 minutes

      // Parse operation from rec_name
      const recNameParts = cycle.work_cycles_rec_name?.split(' | ') || [];
      const cycleOperation = recNameParts[0] || 'Unknown';
      
      // Filter by operation if specified
      if (operation && !cycleOperation.toLowerCase().includes(operation.toLowerCase())) continue;

      const key = `${cycle.work_cycles_operator_id || 0}|${cycle.work_cycles_work_center_rec_name || 'Unknown'}|${cycle.routingRecName || 'Standard'}`;
      
      if (!uphResults.has(key)) {
        uphResults.set(key, {
          operatorId: cycle.work_cycles_operator_id,
          workCenter: cycle.work_cycles_work_center_rec_name || 'Unknown',
          operation: 'Combined',
          routing: cycle.routingRecName || 'Standard',
          totalDuration: 0,
          totalQuantity: 0,
          observations: 0
        });
      }

      const entry = uphResults.get(key)!;
      entry.totalDuration += cycle.work_cycles_duration;
      entry.totalQuantity += cycle.work_cycles_quantity_done || 0;
      entry.observations++;
    }

    // Convert to UPH data format
    const result: UphData[] = [];
    for (const [key, data] of uphResults) {
      if (data.observations === 0 || data.totalDuration === 0) continue;

      const hours = data.totalDuration / 3600; // Convert seconds to hours
      const uph = data.totalQuantity / hours;

      if (uph > 0 && uph <= 500) { // Reasonable UPH range
        result.push({
          id: Math.floor(Math.random() * 1000000), // Temporary ID
          operatorId: data.operatorId,
          workCenter: data.workCenter,
          operation: data.operation,
          routing: data.routing,
          unitsPerHour: Math.round(uph * 100) / 100,
          calculationPeriod: Math.ceil((dateEnd.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24)),
          lastUpdated: new Date()
        });
      }
    }

    return result;
  }

  // Active Work Orders
  async upsertActiveWorkOrder(workOrder: InsertActiveWorkOrder): Promise<ActiveWorkOrder> {
    const [result] = await db
      .insert(activeWorkOrders)
      .values(workOrder)
      .onConflictDoUpdate({
        target: activeWorkOrders.id,
        set: {
          ...workOrder,
          updatedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async getActiveWorkOrders(states?: string[]): Promise<ActiveWorkOrder[]> {
    if (states && states.length > 0) {
      return await db
        .select()
        .from(activeWorkOrders)
        .where(inArray(activeWorkOrders.state, states));
    }
    return await db.select().from(activeWorkOrders);
  }

  async getActiveWorkOrderById(id: number): Promise<ActiveWorkOrder | undefined> {
    const [workOrder] = await db
      .select()
      .from(activeWorkOrders)
      .where(eq(activeWorkOrders.id, id));
    return workOrder || undefined;
  }

  async deleteActiveWorkOrdersByState(state: string): Promise<void> {
    await db
      .delete(activeWorkOrders)
      .where(eq(activeWorkOrders.state, state));
  }

  async deleteActiveWorkOrderById(id: number): Promise<void> {
    await db
      .delete(activeWorkOrders)
      .where(eq(activeWorkOrders.id, id));
  }

  async updateActiveWorkOrderSyncTime(): Promise<void> {
    await db
      .update(activeWorkOrders)
      .set({ lastSyncedAt: new Date() });
  }
}

export const storage = new DatabaseStorage();
