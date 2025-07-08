import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import { eq } from "drizzle-orm";

// Exact CSV structure based on the actual file
interface WorkCyclesCSVRow {
  'work/cycles/duration': string;
  'work/cycles/rec_name': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/operator/write_date': string;
  'work/cycles/work_center/rec_name': string;
  'work/cycles/quantity_done': string;
  'work/production/number': string;
  'work/production/product/code': string;
  'work/production/routing/rec_name': string;
  'work/rec_name': string;
  'work/operation/rec_name': string;
  'work/operation/id': string;
  'work/id': string;
  'work/operator/id': string;
  'work_center/id': string;
  'work/production/id': string;
  'id': string;
}

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Parse HH:MM:SS duration to seconds
 */
function parseDurationToSeconds(duration: string): number {
  if (!duration || duration.trim() === '') return 0;
  
  const parts = duration.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseInt(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  return 0;
}

/**
 * Simple CSV import using exact field mapping
 */
export async function importWorkCyclesFromCSV(
  csvData: WorkCyclesCSVRow[],
  progressCallback?: ProgressCallback
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting simple CSV import for ${csvData.length} records...`);
  
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchSize = 50;
  
  for (let batchStart = 0; batchStart < csvData.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, csvData.length);
    const batch = csvData.slice(batchStart, batchEnd);
    
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const globalIndex = batchStart + i;
      
      try {
        // Skip rows with missing essential data
        if (!row['work/id'] || !row['work/cycles/operator/rec_name'] || !row['work/cycles/duration']) {
          if (globalIndex < 5) {
            console.log(`Row ${globalIndex + 1}: Skipping due to missing essential data`);
          }
          skipped++;
          continue;
        }
        
        const workId = parseInt(row['work/id']);
        if (isNaN(workId)) {
          errors.push(`Row ${globalIndex + 1}: Invalid work ID "${row['work/id']}"`);
          skipped++;
          continue;
        }
        
        // For one-to-many CSV import, allow ALL records - no duplicate checking
        // Each CSV row represents a unique work cycle instance
        // The 'id' field in CSV serves as the unique work cycle identifier
        
        // Parse duration
        const durationSeconds = parseDurationToSeconds(row['work/cycles/duration']);
        const quantityDone = parseFloat(row['work/cycles/quantity_done']) || 0;
        
        // Insert with exact field mapping
        await db.insert(workCycles).values({
          work_cycles_duration: durationSeconds,
          work_cycles_rec_name: row['work/cycles/rec_name'] || null,
          work_cycles_operator_rec_name: row['work/cycles/operator/rec_name'] || null,
          work_cycles_operator_write_date: row['work/cycles/operator/write_date'] ? new Date(row['work/cycles/operator/write_date']) : null,
          work_cycles_work_center_rec_name: row['work/cycles/work_center/rec_name'] || null,
          work_cycles_quantity_done: quantityDone,
          work_production_id: parseInt(row['work/production/id']) || null,
          work_production_number: row['work/production/number'] || null,
          work_production_product_code: row['work/production/product/code'] || null,
          work_production_routing_rec_name: row['work/production/routing/rec_name'] || null,
          work_rec_name: row['work/rec_name'] || null,
          work_operation_rec_name: row['work/operation/rec_name'] || null,
          work_operation_id: parseInt(row['work/operation/id']) || null,
          work_id: workId,
          work_operator_id: parseInt(row['work/operator/id']) || null,
          work_center_id: parseInt(row['work_center/id']) || null,
          work_cycles_operator_id: parseInt(row['work/operator/id']) || null,
        });
        
        imported++;
        
        if (progressCallback && globalIndex % 50 === 0) {
          progressCallback(globalIndex, csvData.length, `Imported ${imported} work cycles...`);
        }
        
      } catch (error) {
        const errorMsg = `Row ${globalIndex + 1}: Failed to import due to: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        if (globalIndex < 5) {
          console.log(errorMsg);
        }
        skipped++;
      }
    }
    
    console.log(`Batch ${Math.floor(batchStart / batchSize) + 1} complete: ${imported} imported, ${skipped} skipped so far...`);
  }
  
  console.log(`CSV import complete: ${imported} imported, ${skipped} skipped`);
  return { imported, skipped, errors };
}