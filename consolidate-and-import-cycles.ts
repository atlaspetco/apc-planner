import { db } from "./server/db.js";
import { workCycles, productionOrders } from "./shared/schema.js";
import { sql } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

interface CsvRow {
  'work/cycles/operator/write_date': string;
  'work/production/create_date': string;
  'work/production/id': string;
  'work/rec_name': string;
  'production_work_number+Operation_rec_name+production_number': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/work_center/category/name': string;
  'work/operation/rec_name': string;
  'work/cycles/duration_sec': string;
  'work/cycles/quantity_done': string;
  'work/cycles/duration': string;
  'work/cycles/rec_name': string;
  'work/production/quantity_done': string;
  'work/production/routing/rec_name': string;
  'work/cycles/work_center/rec_name': string;
  'work/production/number': string;
  'work/production/product/code': string;
  [key: string]: string;
}

interface ConsolidatedRow {
  key: string;
  work_order_number: string | null;
  mo_number: string | null;
  operation_name: string | null;
  operator_name: string | null;
  work_center_category: string | null;
  duration_sec: number;
  quantity_done: number;
  timestamp: string | null;
  work_production_routing_rec_name: string | null;
  work_production_id: number | null;
  work_production_product_code: string | null;
  work_production_quantity: number | null;
  work_production_create_date: string | null;
  work_rec_name: string | null;
  work_cycles_rec_name: string | null;
  work_cycles_work_center_rec_name: string | null;
}

async function consolidateAndImportCycles() {
  console.log("📊 Starting work cycles consolidation and import...");
  
  // Step 1: Clear existing data
  console.log("🗑️ Clearing existing work_cycles data...");
  await db.delete(workCycles);
  console.log("✅ Cleared work_cycles table");
  
  // Step 2: Read and parse CSV
  const csvPath = path.join(process.cwd(), "attached_assets/cycles-appended - tmpuv6ll63e_1753383185435.csv");
  console.log(`📁 Reading CSV from: ${csvPath}`);
  
  const csvContent = readFileSync(csvPath, 'utf-8');
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });
  
  console.log(`📊 Parsed ${rows.length} rows from CSV`);
  
  // Step 3: Group and consolidate data
  const consolidatedMap = new Map<string, ConsolidatedRow>();
  let skippedRows = 0;
  
  for (const row of rows) {
    const key = row['production_work_number+Operation_rec_name+production_number'];
    
    if (!key || key.trim() === '') {
      skippedRows++;
      continue;
    }
    
    // Parse numeric values
    const duration = parseFloat(row['work/cycles/duration_sec']) || 0;
    const quantity = parseFloat(row['work/cycles/quantity_done']) || 0;
    
    if (duration <= 0) {
      skippedRows++;
      continue;
    }
    
    if (consolidatedMap.has(key)) {
      // Add to existing entry
      const existing = consolidatedMap.get(key)!;
      existing.duration_sec += duration;
      existing.quantity_done += quantity;
    } else {
      // Extract work order and MO numbers from key
      const keyParts = key.split(' | ');
      const workOrderNum = keyParts[0] || null;
      const moMatch = key.match(/MO\d+/);
      const moNum = moMatch ? moMatch[0] : null;
      
      // Create new entry
      consolidatedMap.set(key, {
        key: key,
        work_order_number: workOrderNum,
        mo_number: moNum,
        operation_name: row['work/operation/rec_name'] || null,
        operator_name: row['work/cycles/operator/rec_name'] || null,
        work_center_category: row['work/cycles/work_center/category/name'] || null,
        duration_sec: duration,
        quantity_done: quantity,
        timestamp: row['work/cycles/operator/write_date'] || null,
        work_production_routing_rec_name: row['work/production/routing/rec_name'] || null,
        work_production_id: row['work/production/id'] ? parseInt(row['work/production/id']) : null,
        work_production_product_code: row['work/production/product/code'] || null,
        work_production_quantity: row['work/production/quantity_done'] ? parseFloat(row['work/production/quantity_done']) : null,
        work_production_create_date: row['work/production/create_date'] || null,
        work_rec_name: row['work/rec_name'] || null,
        work_cycles_rec_name: row['work/cycles/rec_name'] || null,
        work_cycles_work_center_rec_name: row['work/cycles/work_center/rec_name'] || null
      });
    }
  }
  
  console.log(`📊 Consolidated ${rows.length} rows into ${consolidatedMap.size} unique entries`);
  console.log(`⚠️ Skipped ${skippedRows} rows due to missing key or invalid duration`);
  
  // Step 4: Import consolidated data
  console.log("💾 Importing consolidated data...");
  let imported = 0;
  let failed = 0;
  
  // Get unique operators and create ID mapping
  const operatorMap = new Map<string, number>();
  let operatorId = 1;
  
  for (const consolidated of consolidatedMap.values()) {
    if (consolidated.operator_name && !operatorMap.has(consolidated.operator_name)) {
      operatorMap.set(consolidated.operator_name, operatorId++);
    }
  }
  
  // Import in batches
  const batch = [];
  for (const consolidated of consolidatedMap.values()) {
    try {
      batch.push({
        work_cycles_id: Math.floor(Math.random() * 1000000), // Generate unique ID
        work_cycles_duration: consolidated.duration_sec,
        work_cycles_quantity_done: consolidated.quantity_done,
        work_cycles_rec_name: consolidated.work_cycles_rec_name,
        work_cycles_operator_rec_name: consolidated.operator_name,
        work_cycles_operator_id: consolidated.operator_name ? operatorMap.get(consolidated.operator_name) : null,
        work_cycles_operator_write_date: consolidated.timestamp ? new Date(consolidated.timestamp) : null,
        work_cycles_work_center_rec_name: consolidated.work_cycles_work_center_rec_name,
        work_production_id: consolidated.work_production_id,
        work_production_number: consolidated.mo_number,
        work_production_product_code: consolidated.work_production_product_code,
        work_production_quantity: consolidated.work_production_quantity,
        work_production_priority: null,
        work_production_create_date: consolidated.work_production_create_date ? new Date(consolidated.work_production_create_date) : null,
        work_production_routing_rec_name: consolidated.work_production_routing_rec_name,
        work_rec_name: consolidated.work_rec_name,
        work_operation_rec_name: consolidated.operation_name,
        work_operation_id: null,
        work_id: null,
        work_operator_id: null,
        work_center_id: null,
        state: null,
        data_corrupted: false
      });
      
      if (batch.length >= 100) {
        await db.insert(workCycles).values(batch);
        imported += batch.length;
        batch.length = 0;
        console.log(`✅ Imported ${imported} records so far...`);
      }
    } catch (error) {
      console.error(`❌ Failed to prepare record for key: ${consolidated.key}`, error);
      failed++;
    }
  }
  
  // Insert remaining batch
  if (batch.length > 0) {
    await db.insert(workCycles).values(batch);
    imported += batch.length;
  }
  
  // Step 5: Validate results
  console.log("\n📊 Validation Results:");
  console.log(`✅ Total rows in original CSV: ${rows.length}`);
  console.log(`✅ Unique consolidated entries: ${consolidatedMap.size}`);
  console.log(`✅ Successfully imported: ${imported}`);
  console.log(`❌ Failed imports: ${failed}`);
  
  // Verify database
  const dbCount = await db.select({ count: sql<number>`count(*)` }).from(workCycles);
  console.log(`✅ Records in database: ${dbCount[0].count}`);
  
  // Sample validation
  const samples = await db.select()
    .from(workCycles)
    .limit(5);
  
  console.log("\n📋 Sample imported records:");
  for (const sample of samples) {
    console.log(`- ${sample.work_production_number} | ${sample.work_operation_rec_name} | Duration: ${sample.work_cycles_duration}s | Qty: ${sample.work_cycles_quantity_done}`);
  }
  
  // Also update production_orders table with quantities
  console.log("\n📊 Populating production quantities...");
  const moQuantities = new Map<string, number>();
  
  for (const consolidated of consolidatedMap.values()) {
    if (consolidated.mo_number && consolidated.work_production_quantity) {
      moQuantities.set(consolidated.mo_number, consolidated.work_production_quantity);
    }
  }
  
  for (const [moNumber, quantity] of moQuantities) {
    await db.insert(productionOrders)
      .values({
        moNumber: moNumber,
        quantity: quantity,
        productName: '',
        status: 'done',
        routing: '',
        plannedDate: new Date()
      })
      .onConflictDoUpdate({
        target: productionOrders.moNumber,
        set: { quantity: quantity }
      });
  }
  
  console.log(`✅ Updated ${moQuantities.size} production order quantities`);
  
  return {
    success: true,
    originalRows: rows.length,
    consolidatedEntries: consolidatedMap.size,
    imported: imported,
    failed: failed,
    skipped: skippedRows
  };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  consolidateAndImportCycles()
    .then(result => {
      console.log("\n✅ Consolidation and import complete!", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("\n❌ Error during consolidation:", error);
      process.exit(1);
    });
}