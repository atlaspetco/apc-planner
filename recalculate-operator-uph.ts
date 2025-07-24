import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

// Minimum duration in hours (5 minutes = 0.0833 hours)
const MIN_DURATION_HOURS = 0.0833;

// Maximum realistic UPH values by work center
const MAX_UPH_BY_WORKCENTER: Record<string, number> = {
  'Assembly': 100,    // Manual assembly work
  'Cutting': 500,     // Machine-assisted cutting
  'Packaging': 300,   // Fast but manual
  'Sewing': 100,      // Similar to assembly
  'Rope': 100,        // Similar to assembly
  'Engrave': 1000,    // Machine-based, can be fast
  'Laser': 1000,      // Machine-based, can be fast
};

async function filterOperatorUph() {
  console.log('🔄 Starting filtering of operator_uph table...');
  
  try {
    // Get all existing records
    const result = await db.execute(sql`
      SELECT * FROM operator_uph
    `);
    
    console.log(`📊 Found ${result.rows.length} records in operator_uph table`);
    
    // Process and filter each record
    const validRecords = [];
    const toDelete = [];
    let filtered = 0;
    
    for (const row of result.rows) {
      const record = row as any;
      
      // Check minimum duration filter
      if (record.total_duration_hours < MIN_DURATION_HOURS) {
        console.log(`❌ Filtering: ${record.operator_operation_workcenter} - duration too short: ${record.total_duration_hours} hours`);
        toDelete.push(record.id);
        filtered++;
        continue;
      }
      
      // Extract work center from the combined field
      const parts = record.operator_operation_workcenter?.split(' | ') || [];
      const workCenter = parts[2] || '';
      
      // Find max UPH for this work center
      let maxUph = 1000; // Default max
      for (const [wcKey, max] of Object.entries(MAX_UPH_BY_WORKCENTER)) {
        if (workCenter.toLowerCase().includes(wcKey.toLowerCase())) {
          maxUph = max;
          break;
        }
      }
      
      // Filter out unrealistic UPH values
      if (record.uph > maxUph) {
        console.log(`❌ Filtering: ${record.operator_operation_workcenter} / ${record.routing_name} - UPH: ${Math.round(record.uph)}, exceeds ${maxUph} for ${workCenter}`);
        toDelete.push(record.id);
        filtered++;
      } else {
        validRecords.push(record);
      }
    }
    
    console.log(`\n📊 Filtering summary:`);
    console.log(`  Total records: ${result.rows.length}`);
    console.log(`  Valid records: ${validRecords.length}`);
    console.log(`  Filtered out: ${filtered}`);
    
    // Delete filtered records
    if (toDelete.length > 0) {
      console.log(`\n🗑️ Deleting ${toDelete.length} filtered records...`);
      
      // Delete in batches to avoid query too long
      const batchSize = 100;
      for (let i = 0; i < toDelete.length; i += batchSize) {
        const batch = toDelete.slice(i, i + batchSize);
        await db.execute(sql`
          DELETE FROM operator_uph 
          WHERE id IN ${sql.raw(`(${batch.join(',')})`)}
        `);
      }
    }
    
    // Show summary statistics after filtering
    const stats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_records,
        MIN(uph) as min_uph,
        MAX(uph) as max_uph,
        AVG(uph) as avg_uph
      FROM operator_uph
    `);
    
    const stat = stats.rows[0] as any;
    console.log('\n📈 Operator UPH Statistics after filtering:');
    console.log(`  Total records: ${stat.total_records}`);
    console.log(`  Min UPH: ${Math.round(stat.min_uph * 100) / 100}`);
    console.log(`  Max UPH: ${Math.round(stat.max_uph * 100) / 100}`);
    console.log(`  Avg UPH: ${Math.round(stat.avg_uph * 100) / 100}`);
    
    // Show sample data
    const sample = await db.execute(sql`
      SELECT * FROM operator_uph 
      ORDER BY uph DESC 
      LIMIT 5
    `);
    
    console.log('\n📊 Top 5 UPH values after filtering:');
    sample.rows.forEach((row: any) => {
      const parts = row.operator_operation_workcenter?.split(' | ') || [];
      console.log(`  ${parts[1]} - ${parts[0]} (${parts[2]}) / ${row.routing_name}: ${Math.round(row.uph * 100) / 100} UPH`);
    });
    
  } catch (error) {
    console.error('❌ Error filtering operator UPH:', error);
  }
}

// Run the filtering
filterOperatorUph().then(() => {
  console.log('\n✅ Filtering complete!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});