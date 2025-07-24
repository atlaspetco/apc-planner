/**
 * Test script for pandas consolidation approach
 * 
 * This tests the duration consolidation process to validate
 * the pandas-equivalent approach before full implementation.
 */

import { consolidateDurations } from './consolidate-durations-pandas.js';
import { readFileSync, writeFileSync } from 'fs';

async function testConsolidationProcess() {
  console.log('🧪 Testing pandas consolidation approach...');
  
  try {
    // Create a small test CSV to validate the approach
    const testCsvData = `work/rec_name,work/cycles/operator/rec_name,work/cycles/work_center/category/name,work/cycles/work/production/routing/name,work/production/id,work/id,work/production/create_date,work/production/quantity_done,work/cycles/duration
WO33010 | Sewing | MO150194,Dani Mayta,Assembly,Lifetime Harness,150194,33010,2025-01-15,75,01:30:00
WO33010 | Sewing | MO150194,Dani Mayta,Assembly,Lifetime Harness,150194,33010,2025-01-15,75,00:45:00
WO33011 | Packaging | MO150194,Devin Cann,Packaging,Lifetime Harness,150194,33011,2025-01-15,75,00:20:00
WO33011 | Packaging | MO150194,Devin Cann,Packaging,Lifetime Harness,150194,33011,2025-01-15,75,00:25:00`;

    // Write test CSV
    writeFileSync('test-cycles.csv', testCsvData);
    console.log('📝 Created test CSV with 4 rows (2 duplicates)');
    
    // Run consolidation
    await consolidateDurations('test-cycles.csv', 'test-consolidated.csv');
    
    // Read and validate results
    const consolidatedData = readFileSync('test-consolidated.csv', 'utf-8');
    console.log('📊 Consolidated results:');
    console.log(consolidatedData);
    
    // Expected: 2 consolidated rows
    const lines = consolidatedData.split('\n').filter(line => line.trim());
    console.log(`✅ Input: 4 rows → Output: ${lines.length - 1} rows (excluding header)`);
    
    if (lines.length === 3) { // Header + 2 data rows
      console.log('🎉 Consolidation working correctly!');
      console.log('Ready to implement full UPH rebuild with this approach');
    } else {
      console.log('⚠️ Unexpected consolidation results');
    }
    
  } catch (error: any) {
    console.error('❌ Test failed:', error?.message);
  }
}

// Run test
if (import.meta.url === `file://${process.argv[1]}`) {
  testConsolidationProcess();
}