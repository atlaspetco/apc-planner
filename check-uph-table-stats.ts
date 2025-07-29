import { db } from './server/db.js';
import { uphData } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkUphTableStats() {
  try {
    // Count records
    const [countResult] = await db.select({ count: sql`count(*)` }).from(uphData);
    console.log('Total UPH records:', countResult.count);

    // Check table size
    const tableSize = await db.execute(sql`
      SELECT 
        pg_size_pretty(pg_total_relation_size('uph_data')) as total_size,
        pg_size_pretty(pg_relation_size('uph_data')) as table_size,
        pg_size_pretty(pg_indexes_size('uph_data')) as indexes_size
    `);
    console.log('Table sizes:', tableSize.rows[0]);

    // Check indexes
    const indexes = await db.execute(sql`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'uph_data'
    `);
    console.log('Indexes found:', indexes.rows.length);
    indexes.rows.forEach(idx => {
      console.log(`  - ${idx.indexname}: ${idx.indexdef}`);
    });

    // Check if we have indexes on key columns
    const keyColumns = ['operator_name', 'work_center', 'product_routing'];
    console.log('\nRecommended indexes for query performance:');
    console.log(`  CREATE INDEX idx_uph_data_operator ON uph_data(operator_name);`);
    console.log(`  CREATE INDEX idx_uph_data_work_center ON uph_data(work_center);`);
    console.log(`  CREATE INDEX idx_uph_data_routing ON uph_data(product_routing);`);
    console.log(`  CREATE INDEX idx_uph_data_composite ON uph_data(operator_name, work_center, product_routing);`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUphTableStats();