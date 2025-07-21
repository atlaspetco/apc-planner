import { db } from './server/db.js';
import { productionOrders, workCycles } from './shared/schema.js';
import { sql } from 'drizzle-orm';

async function checkQuantities() {
  try {
    // First check production orders schema
    const poColumns = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'production_orders'
      AND column_name IN ('mo_number', 'quantity', 'status', 'id')
      ORDER BY ordinal_position
    `);
    
    console.log('Production orders table columns:');
    poColumns.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    // Get sample production orders with quantities
    const orders = await db.execute(sql`
      SELECT id, mo_number, quantity, status
      FROM production_orders
      LIMIT 10
    `);

    console.log('\nSample production orders with quantities:');
    orders.rows.forEach(order => {
      console.log(`MO: ${order.mo_number}, Quantity: ${order.quantity}, Status: ${order.status}`);
    });

    // Check work cycles with their quantities for a specific MO
    const testMO = 'MO178232'; // Known MO from logs
    console.log(`\nChecking work cycles for ${testMO}:`);
    const cycles = await db.execute(sql`
      SELECT 
        work_cycles_operator_rec_name as operator,
        work_cycles_quantity_done as quantity,
        work_cycles_duration as duration,
        work_cycles_work_center_rec_name as work_center,
        work_production_number as mo_number
      FROM work_cycles
      WHERE work_production_number = ${testMO}
      LIMIT 10
    `);

    cycles.rows.forEach(cycle => {
      console.log(`  Operator: ${cycle.operator}, WC: ${cycle.work_center}, Quantity: ${cycle.quantity}`);
    });

    // Check if we have work_production_id field
    const columns = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'work_cycles' 
      AND column_name LIKE '%production%'
      ORDER BY column_name
    `);

    console.log('\nWork cycles columns with "production":', columns.rows.map(r => r.column_name));

    // Check a few more MOs to see quantity patterns
    console.log('\nChecking quantities for Belt Bag MOs:');
    const beltBagCycles = await db.execute(sql`
      SELECT 
        work_production_number as mo_number,
        work_cycles_work_center_rec_name as work_center,
        MAX(work_cycles_quantity_done) as max_quantity,
        COUNT(*) as cycle_count
      FROM work_cycles
      WHERE work_production_routing_rec_name = 'Belt Bag'
      AND work_production_number IS NOT NULL
      GROUP BY work_production_number, work_cycles_work_center_rec_name
      ORDER BY work_production_number
      LIMIT 20
    `);

    beltBagCycles.rows.forEach(row => {
      console.log(`  MO: ${row.mo_number}, WC: ${row.work_center}, Max Qty: ${row.max_quantity}, Cycles: ${row.cycle_count}`);
    });

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkQuantities();