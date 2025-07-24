import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import { eq, and } from "drizzle-orm";

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
  'work/production/quantity': string; // CRITICAL for UPH calculations
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
 * Final CSV import with unique ID checking (one-to-many safe)
 */
export async function importWorkCyclesFinal(
  csvData: WorkCyclesCSVRow[],
  progressCallback?: ProgressCallback
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting final CSV import for ${csvData.length} records...`);
  
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
        // Only skip if completely missing CSV ID (the most critical field)
        if (!row['id']) {
          if (globalIndex < 5) {
            console.log(`Row ${globalIndex + 1}: Skipping due to missing CSV ID`);
          }
          skipped++;
          continue;
        }
        
        const csvId = parseInt(row['id']);
        
        if (isNaN(csvId)) {
          errors.push(`Row ${globalIndex + 1}: Invalid CSV ID "${row['id']}"`);
          skipped++;
          continue;
        }
        
        // Enhanced deduplication: Check both CSV ID and composite key
        // First check CSV ID for exact duplicates
        const existingById = await db.select({ id: workCycles.id })
          .from(workCycles)
          .where(eq(workCycles.work_cycles_id, csvId))
          .limit(1);
        
        if (existingById.length > 0) {
          if (globalIndex < 5) {
            console.log(`Row ${globalIndex + 1}: Skipping duplicate CSV ID ${csvId}`);
          }
          skipped++;
          continue;
        }

        // Parse data for composite key checking
        const durationSeconds = parseDurationToSeconds(row['work/cycles/duration']);
        const quantityDone = parseFloat(row['work/cycles/quantity_done']) || 0;
        const workId = parseInt(row['work/id']) || null;
        const operatorName = row['work/cycles/operator/rec_name'] || null;
        const productionId = parseInt(row['work/production/id']) || null;

        // Second check: composite key (workOrderId, operatorId, timestamp, quantity) per ChatGPT recommendations
        if (workId && operatorName && durationSeconds > 0) {
          const existingByComposite = await db.select({ id: workCycles.id })
            .from(workCycles)
            .where(
              and(
                eq(workCycles.work_id, workId),
                eq(workCycles.work_cycles_operator_rec_name, operatorName),
                eq(workCycles.work_cycles_duration, durationSeconds),
                eq(workCycles.work_cycles_quantity_done, quantityDone)
              )
            )
            .limit(1);

          if (existingByComposite.length > 0) {
            if (globalIndex < 5) {
              console.log(`Row ${globalIndex + 1}: Skipping duplicate by composite key (WO:${workId}, Op:${operatorName}, Dur:${durationSeconds}s)`);
            }
            skipped++;
            continue;
          }
        }
        
        // Insert with exact field mapping using work_cycles_id for CSV ID
        await db.insert(workCycles).values({
          work_cycles_id: csvId, // Store CSV ID in dedicated field
          work_cycles_duration: durationSeconds,
          work_cycles_rec_name: row['work/cycles/rec_name'] || null,
          work_cycles_operator_rec_name: operatorName,
          work_cycles_operator_write_date: row['work/cycles/operator/write_date'] ? new Date(row['work/cycles/operator/write_date']) : null,
          work_cycles_work_center_rec_name: row['work/cycles/work_center/rec_name'] || null,
          work_cycles_quantity_done: quantityDone,
          work_production_id: productionId,
          work_production_number: row['work/production/number'] || null,
          work_production_product_code: row['work/production/product/code'] || null,
          work_production_quantity: parseFloat(row['work/production/quantity']) || null, // CRITICAL for UPH calculations
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
  
  // Enhanced import summary per ChatGPT recommendations
  console.log(`\n=== CSV Import Summary ===`);
  console.log(`Total processed: ${csvData.length} records`);
  console.log(`✅ Imported: ${imported} work cycles`);
  console.log(`⏭️  Skipped: ${skipped} records`);
  console.log(`❌ Errors: ${errors.length} records`);
  
  if (errors.length > 0) {
    console.log(`\n--- Error Details ---`);
    errors.slice(0, 5).forEach(error => console.log(`  ${error}`));
    if (errors.length > 5) {
      console.log(`  ... and ${errors.length - 5} more errors`);
    }
  }
  
  if (skipped > 0) {
    const skipReasons = [];
    if (skipped > imported) skipReasons.push("Duplicate detection (CSV ID or composite key)");
    if (errors.length > 0) skipReasons.push("Data validation failures");
    console.log(`\n--- Skip Reasons ---`);
    skipReasons.forEach(reason => console.log(`  • ${reason}`));
  }
  
  console.log(`===========================\n`);
  
  return { imported, skipped, errors };
}