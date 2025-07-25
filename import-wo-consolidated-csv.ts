#!/usr/bin/env npx tsx

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { workCycles, operatorUph } from './shared/schema.ts';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface WorkOrderConsolidation {
  woNumber: string;
  moNumber: string;
  operator: string;
  workCenter: string;
  routing: string;
  productionQuantity: number;
  totalDurationSec: number;
  totalDurationHours: number;
  uph: number;
  createDate: Date | null;
  operation: string;
}

async function importWorkOrderConsolidatedCSV() {
  console.log('🔄 Starting Work Order level consolidated CSV import...');
  
  // Clear existing data
  console.log('🗑️ Clearing existing work cycles and UPH data...');
  await db.delete(workCycles);
  await db.delete(operatorUph);
  
  // Read the new CSV file
  const csvPath = './attached_assets/Untitled spreadsheet - tmpi325y_c5 (1)_1753413762619.csv';
  console.log(`📊 Reading CSV file: ${csvPath}`);
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  
  console.log(`📊 Found ${records.length} records in CSV`);
  
  // Group by Work Order number and consolidate
  const workOrderMap = new Map<string, any[]>();
  
  for (const record of records) {
    const woNumber = record['work/cycles/work/rec_name'];
    if (!woNumber) continue;
    
    if (!workOrderMap.has(woNumber)) {
      workOrderMap.set(woNumber, []);
    }
    workOrderMap.get(woNumber)!.push(record);
  }
  
  console.log(`🔄 Consolidating ${workOrderMap.size} unique Work Orders...`);
  
  const consolidatedWorkOrders: WorkOrderConsolidation[] = [];
  let skipped = 0;
  
  for (const [woNumber, cycles] of workOrderMap) {
    // Get first cycle for metadata
    const firstCycle = cycles[0];
    
    // Validate required fields
    const operator = firstCycle['work/cycles/operator/rec_name'];
    const rawWorkCenter = firstCycle['work/cycles/work_center/category/name']; // Get raw category
    
    // Map work centers to 3-category system
    let workCenter = rawWorkCenter;
    if (rawWorkCenter === 'Sewing' || rawWorkCenter === 'Rope') {
      workCenter = 'Assembly';
    }
    
    const routing = firstCycle['work/cycles/work/production/routing/name'];
    const productionQuantity = parseFloat(firstCycle['work/cycles/work/production/quantity_done']);
    
    if (!operator || !workCenter || !routing || !productionQuantity) {
      skipped++;
      continue;
    }
    
    // Sum all durations for this Work Order
    let totalDurationSec = 0;
    for (const cycle of cycles) {
      const durationStr = cycle['work/cycles/duration_sec'];
      if (durationStr) {
        // Handle comma-separated numbers
        const durationSec = parseFloat(durationStr.replace(/,/g, ''));
        if (!isNaN(durationSec)) {
          totalDurationSec += durationSec;
        }
      }
    }
    
    if (totalDurationSec === 0) {
      skipped++;
      continue;
    }
    
    // Calculate total hours and UPH
    const totalDurationHours = totalDurationSec / 3600;
    const uph = productionQuantity / totalDurationHours;
    
    // Extract MO number from WO
    const moMatch = woNumber.match(/MO(\d+)/);
    const moNumber = moMatch ? `MO${moMatch[1]}` : 'Unknown';
    
    // Parse create date
    let createDate: Date | null = null;
    if (firstCycle['create_date']) {
      try {
        createDate = new Date(firstCycle['create_date']);
        if (isNaN(createDate.getTime())) {
          createDate = null;
        }
      } catch (e) {
        createDate = null;
      }
    }
    
    // Extract operation from work/operation/name field (not work/cycles/rec_name)
    const operation = firstCycle['work/operation/name'] || 'Unknown';
    
    consolidatedWorkOrders.push({
      woNumber,
      moNumber,
      operator,
      workCenter,
      routing,
      productionQuantity,
      totalDurationSec,
      totalDurationHours,
      uph,
      createDate,
      operation
    });
  }
  
  console.log(`📊 Consolidated ${consolidatedWorkOrders.length} Work Orders, skipped ${skipped}`);
  
  // Import consolidated work orders as individual work cycles
  const batchSize = 100;
  let imported = 0;
  
  for (let i = 0; i < consolidatedWorkOrders.length; i += batchSize) {
    const batch = consolidatedWorkOrders.slice(i, i + batchSize);
    const insertData = batch.map((wo, index) => ({
      work_cycles_id: i + index + 1,
      work_cycles_rec_name: wo.woNumber, // WO number for display
      work_cycles_operator_rec_name: wo.operator,
      work_cycles_work_center_rec_name: wo.workCenter, // Use category (Assembly/Cutting/Packaging)
      duration_sec: wo.totalDurationSec,
      work_cycles_quantity_done: wo.productionQuantity,
      work_production_id: parseInt(wo.moNumber.replace('MO', '')),
      work_production_routing_rec_name: wo.routing,
      work_production_number: wo.moNumber,
      work_production_create_date: wo.createDate,
      work_production_quantity: wo.productionQuantity,
      work_operation_rec_name: wo.operation, // Operation for display
      data_corrupted: false
    }));
    
    try {
      await db.insert(workCycles).values(insertData);
      imported += batch.length;
      console.log(`✅ Imported batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(consolidatedWorkOrders.length / batchSize)} (${batch.length} records)`);
    } catch (error) {
      console.error(`❌ Error inserting batch:`, error);
    }
  }
  
  console.log(`\n📈 Import Summary:`);
  console.log(`   • Total Work Orders processed: ${workOrderMap.size}`);
  console.log(`   • Successfully consolidated: ${consolidatedWorkOrders.length}`);
  console.log(`   • Successfully imported: ${imported}`);
  console.log(`   • Skipped (missing data): ${skipped}`);
  console.log(`   • Success rate: ${((imported / workOrderMap.size) * 100).toFixed(1)}%`);
  
  console.log(`\n🎉 Work Order consolidated CSV import completed successfully!`);
  console.log(`   • Each Work Order now represents one consolidated work cycle`);
  console.log(`   • Ready for UPH recalculation using MO quantity / total WO duration`);
  console.log(`   • Data structure optimized for accurate production forecasting`);
}

// Run the import
importWorkOrderConsolidatedCSV().catch(console.error);