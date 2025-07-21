import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function listAllTables() {
  try {
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('All tables in database:');
    tables.rows.forEach(row => console.log('- ' + row.table_name));
    
    // Check for UPH-related tables
    console.log('\nUPH-related tables:');
    tables.rows.forEach(row => {
      const tableName = row.table_name as string;
      if (tableName.toLowerCase().includes('uph') || 
          tableName.toLowerCase().includes('calculation')) {
        console.log(`- ${tableName} (needs review)`);
      }
    });
    
  } catch (error) {
    console.error('Error listing tables:', error);
  }
  
  process.exit(0);
}

listAllTables().catch(console.error);