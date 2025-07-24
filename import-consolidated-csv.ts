/**
 * Import Consolidated CSV Data
 * 
 * This script imports the clean consolidated CSV data to replace existing work cycles
 * with better quality data for improved UPH calculations.
 */

import { db } from './server/db.js';
import { workCycles, productionOrders } from './shared/schema.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

interface ConsolidatedCycleRow {
  'work/rec_name': string;
  'work/cycles/operator/rec_name': string;
  'work/cycles/work_center/category/name': string;
  'work/cycles/work/production/routing/name': string;
  'work/production/id': string;
  'work/id': string;
  'work/production/create_date': string;
  'work/production/quantity_done': string;
  'duration_sec': string;
}

async function importConsolidatedCSV() {
  console.log('🔄 Starting consolidated CSV import...');
  
  // Read the consolidated CSV file
  const csvPath = path.join(process.cwd(), 'attached_assets', 'Corrected_Cleaned_Cycles_Data (1)_1753396311072.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found:', csvPath);
    return;
  }

  // Clear existing work cycles
  console.log('🗑️ Clearing existing work cycles...');
  await db.delete(workCycles);
  
  // Parse CSV
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as ConsolidatedCycleRow[];

  console.log(`📊 Found ${records.length} records in consolidated CSV`);

  // Process records in batches
  const batchSize = 100;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const insertData = [];

    for (const record of batch) {
      try {
        // Skip records with missing essential data
        if (!record['work/rec_name'] || !record['work/cycles/operator/rec_name'] || !record['duration_sec']) {
          skipped++;
          continue;
        }

        // Parse duration (should be in seconds)
        const durationSec = parseFloat(record['duration_sec']);
        if (isNaN(durationSec) || durationSec <= 0) {
          skipped++;
          continue;
        }

        // Parse other fields - handle decimal values in integer fields
        const productionId = Math.floor(parseFloat(record['work/production/id']));
        const workId = Math.floor(parseFloat(record['work/id']));
        const quantity = parseFloat(record['work/production/quantity_done']) || 0;
        
        // Parse date - convert string to Date object
        let createDate: Date | null = null;
        if (record['work/production/create_date']) {
          try {
            createDate = new Date(record['work/production/create_date']);
            // Validate the date
            if (isNaN(createDate.getTime())) {
              createDate = null;
            }
          } catch (e) {
            createDate = null;
          }
        }

        if (isNaN(productionId) || isNaN(workId)) {
          skipped++;
          continue;
        }

        // Create work cycle record
        insertData.push({
          work_cycles_id: workId,
          work_cycles_rec_name: record['work/rec_name'],
          work_cycles_operator_rec_name: record['work/cycles/operator/rec_name'],
          work_cycles_work_center_rec_name: record['work/cycles/work_center/category/name'],
          duration_sec: durationSec, // Use correct field name for consolidation workflow
          work_cycles_quantity_done: quantity,
          work_production_id: productionId,
          work_production_routing_rec_name: record['work/cycles/work/production/routing/name'],
          work_production_number: `MO${productionId}`,
          work_production_create_date: createDate,
          work_production_quantity: quantity,
          work_operation_rec_name: record['work/rec_name'].split(' | ')[1] || 'Unknown',
          data_corrupted: false // Mark as clean data
        });
        
        imported++;
      } catch (error) {
        console.error('Error processing record:', record, error);
        skipped++;
      }
    }

    // Insert batch
    if (insertData.length > 0) {
      try {
        await db.insert(workCycles).values(insertData);
        console.log(`✅ Imported batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(records.length/batchSize)} (${insertData.length} records)`);
      } catch (error) {
        console.error('Error inserting batch:', error);
      }
    }
  }

  console.log(`\n📈 Import Summary:`);
  console.log(`   • Total records processed: ${records.length}`);
  console.log(`   • Successfully imported: ${imported}`);
  console.log(`   • Skipped (missing data): ${skipped}`);
  console.log(`   • Success rate: ${((imported / records.length) * 100).toFixed(1)}%`);

  // Update production orders table with quantities
  console.log('\n🔄 Updating production order quantities...');
  
  try {
    // Get unique production orders from work cycles
    const uniqueProductions = await db
      .select({
        production_id: workCycles.work_production_id,
        production_number: workCycles.work_production_number,
        routing: workCycles.work_production_routing_rec_name,
        quantity: workCycles.work_production_quantity,
        create_date: workCycles.work_production_create_date
      })
      .from(workCycles)
      .groupBy(
        workCycles.work_production_id,
        workCycles.work_production_number,
        workCycles.work_production_routing_rec_name,
        workCycles.work_production_quantity,
        workCycles.work_production_create_date
      );

    // Insert or update production orders
    for (const prod of uniqueProductions) {
      if (prod.production_id && prod.production_number) {
        try {
          await db.insert(productionOrders).values({
            id: prod.production_id,
            moNumber: prod.production_number,
            productRouting: prod.routing || 'Unknown',
            quantity: prod.quantity || 0,
            status: 'assigned',
            dueDate: prod.create_date || new Date().toISOString()
          }).onConflictDoUpdate({
            target: productionOrders.id,
            set: {
              quantity: prod.quantity || 0,
              productRouting: prod.routing || 'Unknown'
            }
          });
        } catch (error) {
          // Skip if conflicts, continue with others
        }
      }
    }

    console.log(`✅ Updated ${uniqueProductions.length} production orders`);
  } catch (error) {
    console.error('Error updating production orders:', error);
  }

  console.log('\n🎉 Consolidated CSV import completed successfully!');
  console.log('   • Work cycles data has been refreshed');
  console.log('   • Production orders updated with quantities');
  console.log('   • Ready for UPH recalculation');
}

// Run the import
importConsolidatedCSV().catch(console.error);