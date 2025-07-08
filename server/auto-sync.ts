import { db } from './db.js';
import { workOrders, productionOrders, workCycles, uphData } from '../shared/schema.js';
import { FulfilAPIService } from './fulfil-api.js';
import { calculateDatabaseUph, storeDatabaseUphResults } from './database-uph-calculator.js';
import { sql, eq, and, inArray, desc, gt } from 'drizzle-orm';

/**
 * Automatic sync system for database/API parity
 * - Runs every 4 hours to sync completed MOs and WOs
 * - Manual refresh for recent MOs (Request/Draft/Waiting states)
 * - Automatic UPH calculation after new records added
 */

let isAutoSyncing = false;
let lastSyncTime = new Date(0);
let syncInterval: NodeJS.Timeout | null = null;

interface SyncResult {
  success: boolean;
  productionOrdersAdded: number;
  workOrdersAdded: number;
  uphCalculationsGenerated: number;
  message: string;
  lastSyncTime: Date;
}

/**
 * Start automatic sync every 4 hours
 */
export function startAutoSync() {
  // Clear any existing interval
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  // Run initial sync
  console.log("Starting automatic sync system...");
  syncCompletedData();
  
  // Set up 4-hour interval (4 * 60 * 60 * 1000 = 14400000 ms)
  syncInterval = setInterval(syncCompletedData, 14400000);
  
  console.log("✓ Automatic sync scheduled every 4 hours");
}

/**
 * Stop automatic sync
 */
export function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  console.log("Automatic sync stopped");
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    isAutoSyncing,
    lastSyncTime,
    nextSyncTime: new Date(lastSyncTime.getTime() + 14400000), // 4 hours from last sync
    autoSyncEnabled: syncInterval !== null
  };
}

/**
 * Sync completed MOs and WOs for database/API parity
 */
export async function syncCompletedData(): Promise<SyncResult> {
  if (isAutoSyncing) {
    return {
      success: false,
      productionOrdersAdded: 0,
      workOrdersAdded: 0,
      uphCalculationsGenerated: 0,
      message: "Sync already in progress",
      lastSyncTime
    };
  }

  isAutoSyncing = true;
  console.log("Starting automatic sync of completed data...");

  try {
    const token = process.env.FULFIL_ACCESS_TOKEN;
    if (!token) {
      throw new Error("FULFIL_ACCESS_TOKEN environment variable is required");
    }

    const fulfilApi = new FulfilAPIService();
    fulfilApi.setApiKey(token);

    // Test connection
    const connectionTest = await fulfilApi.testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Fulfil API connection failed: ${connectionTest.message}`);
    }

    let productionOrdersAdded = 0;
    let workOrdersAdded = 0;

    // Get latest production order from database to sync incrementally
    const latestPO = await db.select()
      .from(productionOrders)
      .orderBy(desc(productionOrders.id))
      .limit(1);

    const lastId = latestPO[0]?.fulfilId || 0;
    console.log(`Syncing production orders from Fulfil ID ${lastId}...`);

    // Fetch completed MOs (state = 'done')
    const completedMOs = await fulfilApi.getProductionOrdersByState('done', 100, lastId);
    console.log(`Found ${completedMOs.length} completed MOs to sync`);

    // Import completed production orders
    for (const mo of completedMOs) {
      try {
        // Check if already exists
        const existing = await db.select()
          .from(productionOrders)
          .where(eq(productionOrders.fulfilId, mo.id))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(productionOrders).values({
            fulfilId: mo.id,
            moNumber: mo.rec_name,
            productCode: mo.product?.code || '',
            routing: mo.routing?.name || '',
            quantity: mo.quantity || 0,
            quantityDone: mo.quantity_done || 0,
            state: mo.state || 'draft',
            dueDate: mo.planned_date ? new Date(mo.planned_date) : null,
            status: 'Completed'
          });
          productionOrdersAdded++;
        }
      } catch (error) {
        console.error(`Error importing MO ${mo.id}:`, error);
      }
    }

    // Fetch completed WOs for these MOs
    const moIds = completedMOs.map(mo => mo.id);
    if (moIds.length > 0) {
      const completedWOs = await fulfilApi.getWorkOrdersByProductionIds(moIds);
      console.log(`Found ${completedWOs.length} completed WOs to sync`);

      // Import completed work orders
      for (const wo of completedWOs) {
        try {
          // Check if already exists
          const existing = await db.select()
            .from(workOrders)
            .where(eq(workOrders.fulfilId, wo.id))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(workOrders).values({
              fulfilId: wo.id,
              productionId: wo.production,
              operationName: wo.operation?.name || '',
              workCenterName: wo.work_center?.name || '',
              operatorName: wo.employee?.name || '',
              quantity_done: wo.quantity_done || 0,
              state: wo.state || 'draft',
              routing: wo.routing?.name || '',
              actualHours: wo.actual_hours || 0,
              dueDate: wo.planned_date ? new Date(wo.planned_date) : null
            });
            workOrdersAdded++;
          }
        } catch (error) {
          console.error(`Error importing WO ${wo.id}:`, error);
        }
      }
    }

    // Calculate UPH for newly added completed data
    let uphCalculationsGenerated = 0;
    if (workOrdersAdded > 0) {
      console.log("Calculating UPH for newly completed work orders...");
      const uphResults = await calculateDatabaseUph();
      await storeDatabaseUphResults(uphResults);
      uphCalculationsGenerated = uphResults.length;
      console.log(`Generated ${uphCalculationsGenerated} UPH calculations`);
    }

    lastSyncTime = new Date();
    const result: SyncResult = {
      success: true,
      productionOrdersAdded,
      workOrdersAdded,
      uphCalculationsGenerated,
      message: `Sync completed: ${productionOrdersAdded} MOs, ${workOrdersAdded} WOs, ${uphCalculationsGenerated} UPH calculations`,
      lastSyncTime
    };

    console.log("✓ Automatic sync completed successfully");
    return result;

  } catch (error) {
    console.error("Automatic sync failed:", error);
    return {
      success: false,
      productionOrdersAdded: 0,
      workOrdersAdded: 0,
      uphCalculationsGenerated: 0,
      message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      lastSyncTime
    };
  } finally {
    isAutoSyncing = false;
  }
}

/**
 * Manual refresh for recent MOs (Request/Draft/Waiting states)
 * Used to populate production planning grid with new orders
 */
export async function manualRefreshRecentMOs(): Promise<SyncResult> {
  console.log("Starting manual refresh of recent MOs...");

  try {
    const token = process.env.FULFIL_ACCESS_TOKEN;
    if (!token) {
      throw new Error("FULFIL_ACCESS_TOKEN environment variable is required");
    }

    const fulfilApi = new FulfilAPIService();
    fulfilApi.setApiKey(token);

    // Test connection
    const connectionTest = await fulfilApi.testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Fulfil API connection failed: ${connectionTest.message}`);
    }

    let productionOrdersAdded = 0;
    let workOrdersAdded = 0;

    // Fetch recent MOs in planning states
    const planningStates = ['request', 'draft', 'waiting', 'assigned'];
    
    for (const state of planningStates) {
      const recentMOs = await fulfilApi.getProductionOrdersByState(state, 50, 0);
      console.log(`Found ${recentMOs.length} MOs in ${state} state`);

      // Import recent production orders
      for (const mo of recentMOs) {
        try {
          // Check if already exists
          const existing = await db.select()
            .from(productionOrders)
            .where(eq(productionOrders.fulfilId, mo.id))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(productionOrders).values({
              fulfilId: mo.id,
              moNumber: mo.rec_name,
              productCode: mo.product?.code || '',
              routing: mo.routing?.name || '',
              quantity: mo.quantity || 0,
              quantityDone: mo.quantity_done || 0,
              state: mo.state || 'draft',
              dueDate: mo.planned_date ? new Date(mo.planned_date) : null,
              status: state === 'request' ? 'Planning' : 'In Progress'
            });
            productionOrdersAdded++;
          }
        } catch (error) {
          console.error(`Error importing recent MO ${mo.id}:`, error);
        }
      }

      // Fetch related WOs for these MOs
      const moIds = recentMOs.map(mo => mo.id);
      if (moIds.length > 0) {
        const recentWOs = await fulfilApi.getWorkOrdersByProductionIds(moIds);
        console.log(`Found ${recentWOs.length} related WOs`);

        // Import related work orders
        for (const wo of recentWOs) {
          try {
            // Check if already exists
            const existing = await db.select()
              .from(workOrders)
              .where(eq(workOrders.fulfilId, wo.id))
              .limit(1);

            if (existing.length === 0) {
              await db.insert(workOrders).values({
                fulfilId: wo.id,
                productionId: wo.production,
                operationName: wo.operation?.name || '',
                workCenterName: wo.work_center?.name || '',
                operatorName: wo.employee?.name || '',
                quantity_done: wo.quantity_done || 0,
                state: wo.state || 'draft',
                routing: wo.routing?.name || '',
                actualHours: wo.actual_hours || 0,
                dueDate: wo.planned_date ? new Date(wo.planned_date) : null
              });
              workOrdersAdded++;
            }
          } catch (error) {
            console.error(`Error importing recent WO ${wo.id}:`, error);
          }
        }
      }
    }

    // Calculate UPH for any completed work orders that were added
    let uphCalculationsGenerated = 0;
    if (workOrdersAdded > 0) {
      console.log("Calculating UPH for newly added work orders...");
      const uphResults = await calculateDatabaseUph();
      await storeDatabaseUphResults(uphResults);
      uphCalculationsGenerated = uphResults.length;
      console.log(`Generated ${uphCalculationsGenerated} UPH calculations`);
    }

    const result: SyncResult = {
      success: true,
      productionOrdersAdded,
      workOrdersAdded,
      uphCalculationsGenerated,
      message: `Manual refresh completed: ${productionOrdersAdded} recent MOs, ${workOrdersAdded} WOs, ${uphCalculationsGenerated} UPH calculations`,
      lastSyncTime: new Date()
    };

    console.log("✓ Manual refresh completed successfully");
    return result;

  } catch (error) {
    console.error("Manual refresh failed:", error);
    return {
      success: false,
      productionOrdersAdded: 0,
      workOrdersAdded: 0,
      uphCalculationsGenerated: 0,
      message: `Manual refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      lastSyncTime: new Date()
    };
  }
}