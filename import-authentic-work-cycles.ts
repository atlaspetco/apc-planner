import fs from 'fs';
import { parse } from 'csv-parse/sync';

// Direct import of authentic work cycles data
async function importAuthenticWorkCycles() {
  try {
    console.log("🚀 Starting authentic work cycles import...");
    
    // Read the authentic work cycles CSV file (22,787 records)
    const csvPath = './attached_assets/Work Cycles - tmpu0ex5p25_1751616591130.csv';
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    
    // Parse CSV data with authentic field structure
    const csvData = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ','
    });
    
    console.log(`📊 Parsed ${csvData.length} authentic work cycles records`);
    console.log("🔧 Sample record:", JSON.stringify(csvData[0], null, 2));
    
    // Call the existing upload endpoint with authentic data
    const response = await fetch('http://localhost:5000/api/fulfil/upload-work-cycles-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ csvData })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log("✅ Authentic work cycles import completed successfully!");
      console.log(`📈 Imported: ${result.imported} records`);
      console.log(`⏭️  Skipped: ${result.skipped} records`);
      console.log(`🔄 Aggregated: ${result.aggregationResult?.aggregatedRecords || 0} records`);
      console.log(`📊 UPH calculations: ${result.uphCalculationResult?.totalCalculations || 0} created`);
    } else {
      console.error("❌ Import failed:", result.message);
      console.error("Error details:", result.error);
    }
    
  } catch (error) {
    console.error("💥 Error during authentic work cycles import:", error);
  }
  
  process.exit(0);
}

// Run the import
importAuthenticWorkCycles();