import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import fetch from 'node-fetch';

const FULFIL_API_KEY = process.env.FULFIL_ACCESS_TOKEN;
const FULFIL_API_URL = 'https://apc.fulfil.io/api/v2';

interface FulfilWorkCycle {
  id: number;
  work: { 
    id: number; 
    production: { 
      id?: number; 
      number?: string;
      routing?: { name?: string };
    };
    operation?: { rec_name?: string };
  };
  operator?: { rec_name?: string };
  work_center?: { rec_name?: string };
  duration?: number;
  quantity_done?: number;
  state?: string;
  create_date?: string;
  "work.production.number"?: string;
  "work.production.routing.rec_name"?: string;
  "work.operation.rec_name"?: string;
  "work_center.rec_name"?: string;
  "operator.rec_name"?: string;
}

export async function importMultipleBatches(
  maxBatches: number = 3,
  batchSize: number = 50,
  delayMs: number = 1000
): Promise<{
  totalImported: number;
  totalSkipped: number;
  batchesProcessed: number;
  errors: string[];
}> {
  let totalImported = 0;
  let totalSkipped = 0;
  let batchesProcessed = 0;
  const errors: string[] = [];

  try {
    // Get the highest ID we currently have
    const latestCycle = await db
      .select({ maxId: workCycles.id })
      .from(workCycles)
      .orderBy(workCycles.id, 'desc')
      .limit(1);
    
    const startId = latestCycle[0]?.maxId || 0;
    console.log(`Starting import from ID: ${startId + 1}`);

    for (let batch = 0; batch < maxBatches; batch++) {
      const offset = batch * batchSize;
      
      console.log(`Fetching batch ${batch + 1}/${maxBatches} (offset: ${offset})...`);
      
      const response = await fetch(`${FULFIL_API_URL}/model/production.work.cycles/search_read`, {
        method: 'PUT',
        headers: {
          'X-API-KEY': FULFIL_API_KEY!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filters: [
            ["state", "=", "done"],
            ["id", ">", startId]
          ],
          fields: [
            "id",
            "work",
            "work.production.number",
            "work.production.routing.rec_name",
            "work.operation.rec_name",
            "operator.rec_name",
            "work_center.rec_name",
            "duration",
            "quantity_done",
            "state",
            "create_date"
          ],
          limit: batchSize,
          offset: offset,
          order: "id ASC"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`Batch ${batch + 1} failed: ${response.statusText} - ${errorText}`);
        continue;
      }

      const data = await response.json() as FulfilWorkCycle[];
      
      if (data.length === 0) {
        console.log(`Batch ${batch + 1}: No more data to import`);
        break;
      }

      // Process and insert the batch
      const validCycles = data
        .filter(cycle => {
          const hasOperator = cycle["operator.rec_name"] || cycle.operator?.rec_name;
          const hasWorkCenter = cycle["work_center.rec_name"] || cycle.work_center?.rec_name;
          const hasDuration = cycle.duration && cycle.duration > 0;
          
          return hasOperator && hasWorkCenter && hasDuration;
        })
        .map(cycle => {
          const operatorName = cycle["operator.rec_name"] || cycle.operator?.rec_name || 'Unknown';
          const workCenterName = cycle["work_center.rec_name"] || cycle.work_center?.rec_name || 'Unknown';
          const operationName = cycle["work.operation.rec_name"] || 
                               cycle.work?.operation?.rec_name || 
                               'Unknown';
          const productionNumber = cycle["work.production.number"] || 
                                  cycle.work?.production?.number || 
                                  'Unknown';
          const routingName = cycle["work.production.routing.rec_name"] || 
                             cycle.work?.production?.routing?.name || 
                             'Unknown';
          
          return {
            id: cycle.id,
            work_id: cycle.work?.id || 0,
            work_production_id: cycle.work?.production?.id || 0,
            work_production_number: productionNumber,
            work_production_routing_rec_name: routingName,
            work_operation_rec_name: operationName,
            work_cycles_operator_rec_name: operatorName,
            work_cycles_work_center_rec_name: workCenterName,
            work_cycles_duration: cycle.duration || 0,
            quantity_done: cycle.quantity_done || 0,
            state: cycle.state || 'done',
            created_at: cycle.create_date ? new Date(cycle.create_date) : new Date()
          };
        });

      if (validCycles.length > 0) {
        // Insert in smaller chunks to avoid conflicts
        const chunkSize = 20;
        for (let i = 0; i < validCycles.length; i += chunkSize) {
          const chunk = validCycles.slice(i, i + chunkSize);
          try {
            await db.insert(workCycles).values(chunk).onConflictDoNothing();
            totalImported += chunk.length;
          } catch (error) {
            console.error(`Error inserting chunk: ${error}`);
            totalSkipped += chunk.length;
          }
        }
      }

      batchesProcessed++;
      console.log(`Batch ${batch + 1}: Imported ${validCycles.length} cycles, skipped ${data.length - validCycles.length}`);
      
      // Update progress
      if (global.updateImportStatus) {
        global.updateImportStatus({
          isImporting: true,
          currentOperation: `Importing batch ${batch + 1}/${maxBatches}`,
          progress: Math.round((batch + 1) / maxBatches * 100)
        });
      }

      // Rate limiting
      if (batch < maxBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return {
      totalImported,
      totalSkipped,
      batchesProcessed,
      errors
    };

  } catch (error) {
    console.error('Error in importMultipleBatches:', error);
    errors.push(error instanceof Error ? error.message : 'Unknown error');
    
    return {
      totalImported,
      totalSkipped,
      batchesProcessed,
      errors
    };
  }
}

export async function fetchNewerWorkCycles(limit: number = 100): Promise<FulfilWorkCycle[]> {
  // This is a simpler version for backward compatibility
  const response = await fetch(`${FULFIL_API_URL}/model/production.work.cycles/search_read`, {
    method: 'PUT',
    headers: {
      'X-API-KEY': FULFIL_API_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filters: [["state", "=", "done"]],
      fields: [
        "id",
        "work",
        "work.production.number",
        "work.production.routing.rec_name",
        "work.operation.rec_name",
        "operator.rec_name", 
        "work_center.rec_name",
        "duration",
        "quantity_done",
        "state",
        "create_date"
      ],
      limit: limit,
      order: "id DESC"
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch work cycles: ${response.statusText}`);
  }

  return await response.json() as FulfilWorkCycle[];
}