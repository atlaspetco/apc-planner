import fs from 'fs';
import { parse } from 'csv-parse/sync';

// Check what's actually in the CSV file
async function debugCsvSample() {
  try {
    // Read first few lines of the CSV to understand format
    const csvContent = fs.readFileSync('./attached_assets/Fulfil API Schema - work.cycles_1751861383472.csv', 'utf-8');
    const lines = csvContent.split('\n').slice(0, 10); // First 10 lines
    
    console.log("=== CSV SAMPLE (First 10 lines) ===");
    lines.forEach((line, index) => {
      console.log(`Line ${index}: ${line}`);
    });
    
    // Parse the CSV and check first few records
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ','
    });
    
    console.log("\n=== PARSED RECORDS (First 5) ===");
    records.slice(0, 5).forEach((record: any, index: number) => {
      console.log(`\nRecord ${index + 1}:`);
      console.log(`  ID: ${record.id}`);
      console.log(`  Duration: ${record['work/cycles/duration'] || record['work_cycles_duration']}`); 
      console.log(`  Operator: ${record['work/cycles/operator/rec_name'] || record['work_cycles_operator_rec_name']}`);
      console.log(`  Work ID: ${record['work/id'] || record['work_id']}`);
      console.log(`  Production ID: ${record['work/production/id'] || record['work_production_id']}`);
      console.log(`  Quantity: ${record['work/cycles/quantity_done'] || record['work_cycles_quantity_done']}`);
    });
    
    console.log(`\nTotal records in CSV: ${records.length}`);
    
  } catch (error) {
    console.error('Error reading CSV:', error);
  }
  process.exit(0);
}

debugCsvSample();