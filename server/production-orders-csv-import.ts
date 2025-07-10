import { db } from "./db.js";
import { productionOrders, workOrders } from "../shared/schema.js";
import { eq } from "drizzle-orm";

// Production Orders CSV structure based on Fulfil API export
interface ProductionOrderCSVRow {
  'id': string;
  'rec_name': string;
  'product_code': string;
  'routing/rec_name': string;
  'quantity_done': string;
  'work_center/rec_name': string;
  'works/rec_name': string;
  'planned_date': string;
  'planned_start_date': string;
  'create_date': string;
  'state'?: string;
  'quantity'?: string;
}

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Import production orders from CSV data
 */
export async function importProductionOrdersFromCSV(
  csvData: ProductionOrderCSVRow[],
  progressCallback?: ProgressCallback
): Promise<{
  productionOrdersImported: number;
  workOrdersImported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting production orders CSV import for ${csvData.length} records...`);
  
  let productionOrdersImported = 0;
  let workOrdersImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchSize = 50;
  
  // Track unique production orders to avoid duplicates
  const processedPOs = new Set<string>();
  
  for (let batchStart = 0; batchStart < csvData.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, csvData.length);
    const batch = csvData.slice(batchStart, batchEnd);
    
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const globalIndex = batchStart + i;
      
      try {
        // Skip rows with missing critical data
        if (!row.id || !row.rec_name) {
          if (globalIndex < 5) {
            console.log(`Row ${globalIndex + 1}: Skipping due to missing ID or rec_name`);
          }
          skipped++;
          continue;
        }
        
        const fulfilId = parseInt(row.id);
        const moNumber = row.rec_name;
        
        if (isNaN(fulfilId)) {
          errors.push(`Row ${globalIndex + 1}: Invalid production order ID "${row.id}"`);
          skipped++;
          continue;
        }
        
        // Check if production order already exists
        const existingPO = await db.select({ id: productionOrders.id })
          .from(productionOrders)
          .where(eq(productionOrders.fulfilId, fulfilId))
          .limit(1);
        
        if (existingPO.length > 0 || processedPOs.has(moNumber)) {
          if (globalIndex < 5) {
            console.log(`Row ${globalIndex + 1}: Skipping duplicate MO ${moNumber}`);
          }
          skipped++;
          continue;
        }
        
        // Parse optional fields
        const quantityDone = parseFloat(row.quantity_done) || 0;
        const quantity = parseFloat(row.quantity || row.quantity_done) || quantityDone;
        const productCode = row.product_code || null;
        const routing = row['routing/rec_name'] || null;
        
        // Determine status from state or default to assigned
        let status = "assigned";
        if (row.state) {
          status = row.state.toLowerCase();
        } else if (quantityDone > 0) {
          status = "running";
        }
        
        // Parse dates
        let plannedDate = null;
        if (row.planned_date && row.planned_date !== "") {
          try {
            plannedDate = new Date(row.planned_date).toISOString();
          } catch (e) {
            // Invalid date, keep null
          }
        }
        
        // Create production order
        const [newPO] = await db.insert(productionOrders).values({
          moNumber: moNumber,
          productName: productCode ? `Product ${productCode}` : `Product ${fulfilId}`,
          quantity: quantity,
          status: status,
          routing: routing,
          dueDate: plannedDate,
          priority: "Medium",
          fulfilId: fulfilId,
          rec_name: moNumber,
          product_code: productCode,
          routingName: routing,
          planned_date: plannedDate
        }).returning({ id: productionOrders.id });
        
        processedPOs.add(moNumber);
        productionOrdersImported++;
        
        // Create work order if work data is present
        if (row['works/rec_name'] && row['work_center/rec_name']) {
          const workRecName = row['works/rec_name'];
          const workCenter = row['work_center/rec_name'];
          
          // Parse work order details from rec_name (e.g., "WO105 | Cutting - LC | MO5471")
          const workOrderMatch = workRecName.match(/^(WO\d+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/);
          let operation = "Manufacturing";
          let workOrderNumber = `WO${fulfilId}`;
          
          if (workOrderMatch) {
            workOrderNumber = workOrderMatch[1];
            operation = workOrderMatch[2].trim();
          }
          
          await db.insert(workOrders).values({
            workOrderNumber: workOrderNumber,
            productionOrderId: newPO.id,
            operation: operation,
            workCenter: workCenter || "General",
            status: status,
            assignedOperatorId: null,
            estimatedHours: null,
            actualHours: null,
            quantity: quantity,
            routing: routing,
            fulfilId: null,
            rec_name: workRecName
          });
          
          workOrdersImported++;
        }
        
        if (progressCallback && globalIndex % 50 === 0) {
          progressCallback(
            globalIndex + 1, 
            csvData.length, 
            `Processing production order ${moNumber}...`
          );
        }
        
      } catch (error) {
        const errorMsg = `Row ${globalIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
    console.log(`Batch ${Math.floor(batchStart / batchSize) + 1} complete: ${productionOrdersImported} POs, ${workOrdersImported} WOs imported, ${skipped} skipped so far...`);
  }
  
  console.log(`=== Production Orders CSV Import Summary ===`);
  console.log(`Total processed: ${csvData.length} records`);
  console.log(`✅ Production Orders Imported: ${productionOrdersImported}`);
  console.log(`✅ Work Orders Imported: ${workOrdersImported}`);
  console.log(`⏭️  Skipped: ${skipped} records`);
  console.log(`❌ Errors: ${errors.length} records`);
  console.log(`===========================================`);
  
  return {
    productionOrdersImported,
    workOrdersImported,
    skipped,
    errors
  };
}