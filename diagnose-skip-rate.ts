import fs from 'fs';
import { parse } from 'csv-parse/sync';

// Diagnose why records are being skipped
async function diagnoseSkipRate() {
  try {
    console.log("🔍 Diagnosing high skip rate...");
    
    // Read and parse CSV
    const csvPath = './attached_assets/Work Cycles - tmpu0ex5p25_1751616591130.csv';
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const csvData = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ','
    });
    
    console.log(`📊 Total records: ${csvData.length}`);
    
    // Transform headers like the import does
    function transformHeader(header: string): string {
      return header.replace(/\//g, '_');
    }
    
    const transformedData = csvData.map(row => {
      const transformedRow: any = {};
      for (const [key, value] of Object.entries(row)) {
        const transformedKey = transformHeader(key);
        transformedRow[transformedKey] = value as string;
      }
      return transformedRow;
    });
    
    // Check first 10 records for validation issues
    console.log("\n🔬 Analyzing first 10 records for validation issues:\n");
    
    for (let i = 0; i < Math.min(10, transformedData.length); i++) {
      const row = transformedData[i];
      console.log(`--- Record ${i + 1} ---`);
      
      // Check ID
      const hasId = !!row['id'];
      const csvId = parseInt(row['id']);
      const validId = !isNaN(csvId);
      console.log(`  ID: ${row['id']} → hasId: ${hasId}, validId: ${validId}`);
      
      // Check duration
      const duration = row['work_cycles_duration'];
      const parsedDuration = parseDurationToSeconds(duration);
      console.log(`  Duration: "${duration}" → ${parsedDuration}s (valid: ${parsedDuration > 0})`);
      
      // Check operator
      const operator = row['work_cycles_operator_rec_name'];
      const hasOperator = !!(operator && operator.trim() !== '');
      console.log(`  Operator: "${operator}" → hasOperator: ${hasOperator}`);
      
      // Check work ID
      const workId = parseInt(row['work_id']);
      const validWorkId = !isNaN(workId);
      console.log(`  Work ID: ${row['work_id']} → validWorkId: ${validWorkId}`);
      
      // Check production ID  
      const productionId = parseInt(row['work_production_id']);
      const validProductionId = !isNaN(productionId);
      console.log(`  Production ID: ${row['work_production_id']} → validProductionId: ${validProductionId}`);
      
      // Overall validation
      const wouldPass = hasId && validId && parsedDuration > 0 && hasOperator;
      console.log(`  ✅ Would pass validation: ${wouldPass}\n`);
    }
    
    // Sample validation statistics
    let validCount = 0;
    let invalidId = 0;
    let invalidDuration = 0;
    let missingOperator = 0;
    
    for (let i = 0; i < Math.min(1000, transformedData.length); i++) {
      const row = transformedData[i];
      
      const hasId = !!row['id'];
      const csvId = parseInt(row['id']);
      const validId = !isNaN(csvId);
      const duration = parseDurationToSeconds(row['work_cycles_duration']);
      const operator = row['work_cycles_operator_rec_name'];
      const hasOperator = !!(operator && operator.trim() !== '');
      
      if (!hasId || !validId) invalidId++;
      else if (duration <= 0) invalidDuration++;
      else if (!hasOperator) missingOperator++;
      else validCount++;
    }
    
    console.log("📈 Sample validation statistics (first 1000 records):");
    console.log(`  Valid records: ${validCount}`);
    console.log(`  Invalid ID: ${invalidId}`);
    console.log(`  Invalid duration: ${invalidDuration}`);  
    console.log(`  Missing operator: ${missingOperator}`);
    console.log(`  Expected success rate: ${(validCount/1000*100).toFixed(1)}%`);
    
    // Check for internal CSV duplicates by ID
    console.log("\n🔍 Checking for duplicate IDs in CSV...");
    const allIds = new Set();
    const duplicateIds = new Set();
    
    for (let i = 0; i < transformedData.length; i++) {
      const id = transformedData[i]['id'];
      if (id && allIds.has(id)) {
        duplicateIds.add(id);
      } else if (id) {
        allIds.add(id);
      }
    }
    
    console.log(`  Unique IDs: ${allIds.size}`);
    console.log(`  Duplicate IDs found: ${duplicateIds.size}`);
    console.log(`  Total records: ${transformedData.length}`);
    console.log(`  Expected unique records: ${allIds.size} (${(allIds.size/transformedData.length*100).toFixed(1)}%)`);
    
    if (duplicateIds.size > 0) {
      console.log(`  ⚠️  CSV contains ${duplicateIds.size} duplicate IDs - this explains the high skip rate!`);
      console.log(`  Sample duplicate IDs:`, Array.from(duplicateIds).slice(0, 5));
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
  
  process.exit(0);
}

// Duration parsing function (copied from csv-import-final.ts)
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

diagnoseSkipRate();