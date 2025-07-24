import { pgTable, text, serial, integer, boolean, timestamp, real, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const productionOrders = pgTable("production_orders", {
  id: serial("id").primaryKey(),
  moNumber: text("mo_number").notNull().unique(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull(), // Requests, Draft, Waiting, Assigned, Running
  routing: text("routing"), // Product routing name from Fulfil API
  dueDate: timestamp("due_date"),
  batchId: text("batch_id"),
  priority: text("priority").default("Normal"), // High, Normal, Low
  fulfilId: integer("fulfil_id"), // Reference to Fulfil.io production order ID
  createdAt: timestamp("created_at").defaultNow(),
  // Fulfil API compatible fields
  rec_name: text("rec_name"), // Fulfil display name (e.g., "MO5471")
  state: text("state"), // Fulfil state: draft, waiting, assigned, running, done
  planned_date: text("planned_date"), // Fulfil planned date
  create_date: text("create_date"), // Fulfil creation date
  product_code: text("product_code"), // Fulfil product.code field
});

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id").references(() => productionOrders.id, { onDelete: "cascade" }),
  workCenter: text("work_center").notNull(), // Cutting, Assembly, Packaging, Rope
  operation: text("operation").notNull(),
  routing: text("routing").notNull(),
  assignedOperatorId: integer("assigned_operator_id"),
  estimatedHours: real("estimated_hours"),
  actualHours: real("actual_hours"),
  cycleIds: text("cycle_ids").array(), // Array of Fulfil cycle IDs
  totalCycleDuration: integer("total_cycle_duration"), // Total duration in seconds
  quantityDone: real("quantity_done"),
  status: text("status").default("Pending"), // Pending, In Progress, Completed
  sequence: integer("sequence").notNull(),
  fulfilId: integer("fulfil_id"), // Reference to Fulfil.io work order ID
  // Fulfil API compatible fields
  production: integer("production"), // Fulfil production order reference
  work_center: integer("work_center_id"), // Fulfil work center ID
  operationId: integer("operation_id"), // Fulfil operation ID
  operator: integer("operator"), // Fulfil operator/employee ID
  quantity_done: real("quantity_done_fulfil"), // Fulfil field name
  state: text("state"), // Fulfil state field: draft, assigned, running, done
  rec_name: text("rec_name"), // Fulfil display name
  planned_date: text("planned_date"), // Fulfil planned date
  create_date: text("create_date"), // Fulfil creation date
  priority: text("priority"), // Fulfil priority
  type: text("type"), // Fulfil work order type
  cost: text("cost"), // Fulfil cost as string
  workCenterName: text("work_center_name"), // Denormalized work center name
  operationName: text("operation_name"), // Denormalized operation name
  operatorName: text("operator_name"), // Denormalized operator name
});

// Active Work Orders table - stores current work orders from Fulfil for planning
export const activeWorkOrders = pgTable("active_work_orders", {
  id: integer("id").primaryKey(), // Use Fulfil work order ID as primary key
  productionOrderId: integer("production_order_id").notNull().references(() => productionOrders.id, { onDelete: "cascade" }),
  moNumber: text("mo_number").notNull(),
  productName: text("product_name").notNull(),
  productCode: text("product_code"),
  workCenter: text("work_center").notNull(), // Display work center (Cutting, Assembly, Packaging)
  originalWorkCenter: text("original_work_center"), // Original from Fulfil
  operation: text("operation").notNull(),
  routing: text("routing").notNull(),
  state: text("state").notNull(), // request, draft, waiting, assigned, running, finished, done
  quantity: integer("quantity").notNull(),
  plannedDate: timestamp("planned_date"),
  rec_name: text("rec_name"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const operators = pgTable("operators", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slackUserId: text("slack_user_id"),
  availableHours: integer("available_hours").default(40),
  workCenters: text("work_centers").array(), // Array of work centers they're trained in
  routings: text("routings").array(), // Array of routings they know
  operations: text("operations").array(), // Array of operations they can perform
  isActive: boolean("is_active").default(true),
  lastActiveDate: timestamp("last_active_date"),
  uphCalculationWindow: integer("uph_calculation_window").default(30), // days
  fulfilId: integer("fulfil_id"), // Reference to Fulfil.io employee ID
});

export const workOrderAssignments = pgTable("work_order_assignments", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull(), // Fulfil work order ID (not local DB ID)
  operatorId: integer("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  assignedBy: text("assigned_by").default("dashboard"), // Could track which user made assignment
  isActive: boolean("is_active").default(true),
  isAutoAssigned: boolean("is_auto_assigned").default(false), // Track if assignment was made by AI
  autoAssignReason: text("auto_assign_reason"), // AI's reasoning for the assignment
  autoAssignConfidence: real("auto_assign_confidence") // Confidence score (0-1)
});

export const uphData = pgTable("uph_data", {
  id: serial("id").primaryKey(),
  operatorId: integer("operator_id").references(() => operators.id, { onDelete: "cascade" }),
  operatorName: text("operator_name").notNull(),
  workCenter: text("work_center").notNull(),
  operation: text("operation").notNull(),
  productRouting: text("product_routing").notNull(),
  uph: real("uph").notNull(), // Units per hour
  observationCount: integer("observation_count").default(1),
  totalDurationHours: real("total_duration_hours"),
  totalQuantity: integer("total_quantity"),
  dataSource: text("data_source").default("manual"),
  calculationPeriod: integer("calculation_period").default(30), // days
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const batches = pgTable("batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priority: text("priority").default("Normal"),
  dueDate: timestamp("due_date"),
  totalEstimatedHours: real("total_estimated_hours"),
  status: text("status").default("Planning"), // Planning, In Progress, Completed
  createdAt: timestamp("created_at").defaultNow(),
});

// Work cycles table - clean authentic Fulfil API field names only
export const workCycles = pgTable("work_cycles", {
  id: serial("id").primaryKey(),
  // Authentic Fulfil API fields - exact endpoint names
  work_cycles_duration: real("work_cycles_duration"), // work/cycles/duration
  work_cycles_id: integer("work_cycles_id"), // work/cycles/id
  work_cycles_rec_name: text("work_cycles_rec_name"), // work/cycles/rec_name
  work_cycles_operator_rec_name: text("work_cycles_operator_rec_name"), // work/cycles/operator/rec_name
  work_cycles_operator_id: integer("work_cycles_operator_id"), // work/cycles/operator/id
  work_cycles_operator_write_date: timestamp("work_cycles_operator_write_date"), // work/cycles/operator/write_date
  work_cycles_work_center_rec_name: text("work_cycles_work_center_rec_name"), // work/cycles/work_center/rec_name
  work_cycles_quantity_done: real("work_cycles_quantity_done"), // work/cycles/quantity_done
  work_production_id: integer("work_production_id"), // work/production/id
  work_production_number: text("work_production_number"), // work/production/number
  work_production_product_code: text("work_production_product_code"), // work/production/product/code
  work_production_quantity: real("work_production_quantity"), // work/production/quantity - CRITICAL for correct UPH calculation
  work_production_priority: text("work_production_priority"), // work/production/priority
  work_production_create_date: timestamp("work_production_create_date"), // work/production/create_date
  work_production_routing_rec_name: text("work_production_routing_rec_name"), // work/production/routing/rec_name
  work_rec_name: text("work_rec_name"), // work/rec_name
  work_operation_rec_name: text("work_operation_rec_name"), // work/operation/rec_name
  work_operation_id: integer("work_operation_id"), // work/operation/id
  work_id: integer("work_id"), // work/id
  work_operator_id: integer("work_operator_id"), // work/operator/id
  work_center_id: integer("work_center_id"), // work_center/id
  state: text("state"), // work cycle state (done, etc.)
  data_corrupted: boolean("data_corrupted").default(false), // Flag for corrupted records with identical short durations
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Fulfil reference tables for ID to name mappings
export const fulfilWorkCenters = pgTable("fulfil_work_centers", {
  id: integer("id").primaryKey(), // Fulfil work center ID
  name: text("name").notNull(), // Work center name from Fulfil
  standardName: text("standard_name").notNull(), // Mapped standard name (Sewing, Cutting, Assembly, Packaging)
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const fulfilOperations = pgTable("fulfil_operations", {
  id: integer("id").primaryKey(), // Fulfil operation ID
  name: text("name").notNull(), // Operation name from Fulfil
  workCenterId: integer("work_center_id"), // Associated work center ID
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// Production Routing table - mirrors exact Fulfil API schema
export const productionRouting = pgTable("production_routing", {
  id: integer("id").primaryKey(), // Fulfil routing ID
  active: boolean("active").default(true), // Active status
  create_date: timestamp("create_date"), // Created At (Timestamp) - readonly
  create_uid: integer("create_uid"), // Create User - readonly
  messages: json("messages"), // Messages - readonly  
  metadata: json("metadata"), // Metadata
  metafields: json("metafields"), // Metafields
  name: text("name").notNull(), // Name - required
  private_notes: json("private_notes"), // Private Notes - readonly
  public_notes: json("public_notes"), // Public Notes - readonly
  rec_blurb: json("rec_blurb"), // Blurb - readonly
  rec_name: text("rec_name"), // Record Name (Title) - readonly
  steps: json("steps"), // Steps - one2many
  write_date: timestamp("write_date"), // Updated At (Timestamp) - readonly
  write_uid: integer("write_uid"), // Write User - readonly
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const fulfilRoutings = pgTable("fulfil_routings", {
  id: integer("id").primaryKey(), // Fulfil routing ID
  name: text("name").notNull(), // Routing name from Fulfil
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const fulfilOperators = pgTable("fulfil_operators", {
  id: integer("id").primaryKey(), // Fulfil operator/employee ID
  name: text("name").notNull(), // Operator name from Fulfil
  lastUpdated: timestamp("last_updated").defaultNow(),
});



// Aggregated UPH calculation table - merges multiple work cycles per MO
export const uphCalculationData = pgTable("uph_calculation_data", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id"), // The key field for Work Order level aggregation
  productionNumber: text("production_number"), // Now nullable for operator/workCenter/routing aggregation
  productionId: integer("production_id"),
  operatorName: text("operator_name").notNull(),
  operatorId: integer("operator_id"),
  workCenter: text("work_center").notNull(),
  routing: text("routing"),
  operation: text("operation"),
  productCode: text("product_code"),
  totalQuantityDone: integer("total_quantity_done").notNull(),
  totalDurationSeconds: integer("total_duration_seconds").notNull(),
  cycleCount: integer("cycle_count").notNull(), // Number of cycles aggregated
  lastActivity: timestamp("last_activity"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

// Insert schemas
export const insertProductionOrderSchema = createInsertSchema(productionOrders).omit({
  id: true,
  createdAt: true,
});

export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({
  id: true,
});

export const insertActiveWorkOrderSchema = createInsertSchema(activeWorkOrders).omit({
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOperatorSchema = createInsertSchema(operators).omit({
  id: true,
  lastActiveDate: true,
});

export const insertUphDataSchema = createInsertSchema(uphData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBatchSchema = createInsertSchema(batches).omit({
  id: true,
  createdAt: true,
});

export const insertWorkCycleSchema = createInsertSchema(workCycles).omit({
  id: true,
  createdAt: true,
});



export const insertUphCalculationDataSchema = createInsertSchema(uphCalculationData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type ProductionOrder = typeof productionOrders.$inferSelect;
export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type ActiveWorkOrder = typeof activeWorkOrders.$inferSelect;
export type InsertActiveWorkOrder = z.infer<typeof insertActiveWorkOrderSchema>;
export type Operator = typeof operators.$inferSelect;
export type InsertOperator = z.infer<typeof insertOperatorSchema>;
export type UphData = typeof uphData.$inferSelect;
export type InsertUphData = z.infer<typeof insertUphDataSchema>;
export type Batch = typeof batches.$inferSelect;
export type InsertBatch = z.infer<typeof insertBatchSchema>;
export type WorkCycle = typeof workCycles.$inferSelect;
export type InsertWorkCycle = z.infer<typeof insertWorkCycleSchema>;

export type UphCalculationData = typeof uphCalculationData.$inferSelect;
export type InsertUphCalculationData = z.infer<typeof insertUphCalculationDataSchema>;

// Dashboard types
export const statusFilterSchema = z.array(z.enum(["Requests", "Draft", "Waiting", "Assigned", "Running"]));

export const operatorAssignmentSchema = z.object({
  workOrderId: z.union([z.number(), z.string().transform(val => parseInt(val, 10))]),
  operatorId: z.number(),
});

export const batchAssignmentSchema = z.object({
  productionOrderIds: z.array(z.number()),
  batchName: z.string(),
  priority: z.enum(["High", "Normal", "Low"]).optional(),
});
