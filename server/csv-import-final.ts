import { db } from "./db.js";
import { workCycles } from "../shared/schema.js";
import { eq, and } from "drizzle-orm";

// Dynamic row structure that accepts both slash and underscore formats
interface WorkCyclesCSVRow {
  [key: string]: string;
}

interface ProgressCallback {
  (current: number, total: number, message: string): void;
}

/**
 * Transform CSV headers from Fulfil API format (with slashes) to database format (with underscores)
 * e.g., "work/cycles/duration" -> "work_cycles_duration"
 */
function transformHeader(header: string): string {
  return header.replace(/\//g, '_');
}

/**
 * Transform all headers in CSV data to match database schema
 */
function transformCSVHeaders(csvData: any[]): WorkCyclesCSVRow[] {
  if (!csvData || csvData.length === 0) return [];
  
  return csvData.map(row => {
    const transformedRow: WorkCyclesCSVRow = {};
    
    for (const [key, value] of Object.entries(row)) {
      const transformedKey = transformHeader(key);
      transformedRow[transformedKey] = value as string;
    }
    
    return transformedRow;
  });
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
  csvData: any[],
  progressCallback?: ProgressCallback
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(`Starting final CSV import for ${csvData.length} records...`);
  console.log(`Sample original headers:`, Object.keys(csvData[0] || {}));
  
  // Transform CSV headers to match database schema
  const transformedData = transformCSVHeaders(csvData);
  console.log(`Sample transformed headers:`, Object.keys(transformedData[0] || {}));
  
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchSize = 50;
  
  for (let batchStart = 0; batchStart < transformedData.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, transformedData.length);
    const batch = transformedData.slice(batchStart, batchEnd);
    
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
        const durationSeconds = parseDurationToSeconds(row['work_cycles_duration']);
        const quantityDone = parseFloat(row['work_cycles_quantity_done']) || 0;
        const workId = parseInt(row['work_id']) || null;
        const operatorName = row['work_cycles_operator_rec_name'] || null;
        const productionId = parseInt(row['work_production_id']) || null;

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
          work_cycles_rec_name: row['work_cycles_rec_name'] || null,
          work_cycles_operator_rec_name: operatorName,
          work_cycles_operator_write_date: row['work_cycles_operator_write_date'] ? new Date(row['work_cycles_operator_write_date']) : null,
          work_cycles_work_center_rec_name: row['work_cycles_work_center_rec_name'] || null,
          work_cycles_quantity_done: quantityDone,
          work_production_id: productionId,
          work_production_number: row['work_production_number'] || null,
          work_production_product_code: row['work_production_product_code'] || null,
          work_production_routing_rec_name: row['work_production_routing_rec_name'] || null,
          work_rec_name: row['work_rec_name'] || null,
          work_operation_rec_name: row['work_operation_rec_name'] || null,
          work_operation_id: parseInt(row['work_operation_id']) || null,
          work_id: workId,
          work_operator_id: parseInt(row['work_operator_id']) || null,
          work_center_id: parseInt(row['work_center_id']) || null,
          work_cycles_operator_id: parseInt(row['work_operator_id']) || null,
        });

        imported++;
        
        if (progressCallback && globalIndex % 50 === 0) {
          progressCallback(globalIndex, transformedData.length, `Imported ${imported} work cycles...`);
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
  console.log(`Total processed: ${transformedData.length} records`);
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