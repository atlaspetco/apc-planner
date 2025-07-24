import { db } from './db.js';
import { sql } from 'drizzle-orm';

interface FulfilWorkCycle {
  id: number;
  operator_rec_name: string;
  rec_name: string;
  production: number;
  work_center_category: string;
  work_operation_rec_name: string;
  production_work_cycles_duration: number; // Already in seconds from API
  production_work_cycles_id: number;
  work_cycles_work_center_rec_name: string;
  state: string;
  production_routing_rec_name: string;
  production_quantity: number;
  create_date: string;
  production_planned_date: string;
  production_priority: number;
}

async function fetchWorkCyclesFromFulfilAPI(): Promise<FulfilWorkCycle[]> {
  const accessToken = process.env.FULFIL_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('FULFIL_ACCESS_TOKEN not found in environment variables');
  }

  const response = await fetch('https://apc.fulfil.io/api/v2/model/production.work/search_read', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': accessToken
    },
    body: JSON.stringify({
      filters: [
        ['state', 'in', ['done', 'finished']]
      ],
      fields: [
        'id',
        'operator_rec_name',
        'rec_name',
        'production',
        'work_center_category',
        'work_operation_rec_name',
        'production_work_cycles_duration',
        'production_work_cycles_id',
        'work_cycles_work_center_rec_name',
        'state',
        'production_routing_rec_name',
        'production_quantity',
        'create_date',
        'production_planned_date',
        'production_priority'
      ],
      limit: 10000 // Process in chunks if needed
    })
  });

  if (!response.ok) {
    throw new Error(`Fulfil API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

function parseRecName(recName: string): { woNumber: string; moNumber: string; operation: string } {
  // Example: "WO21691 | Packaging | MO23577"
  const parts = recName.split(' | ');
  
  return {
    woNumber: parts[0] || '',
    operation: parts[1] || '',
    moNumber: parts[2] || ''
  };
}

/**
 * Map work center to category following the rules:
 * - Rope, Sewing → Assembly
 * - Cutting remains Cutting
 * - Packaging remains Packaging
 */
function getWorkCenterCategory(workCenter: string): string {
  const wcLower = workCenter.toLowerCase();
  
  if (wcLower.includes('rope') || wcLower.includes('sewing')) {
    return 'Assembly';
  } else if (wcLower.includes('cutting')) {
    return 'Cutting';
  } else if (wcLower.includes('packaging')) {
    return 'Packaging';
  } else if (wcLower.includes('assembly')) {
    return 'Assembly';
  }
  
  // Default fallback
  return workCenter;
}

async function importWorkCyclesFromFulfilAPI() {
  console.log("🚀 Starting Fulfil API Work Cycles Import");
  
  try {
    // Clear existing data
    console.log("🗑️  Clearing existing work cycles...");
    await db.execute(sql`DELETE FROM work_cycles`);
    
    // Fetch data from API
    console.log("📡 Fetching work cycles from Fulfil API...");
    const workCycles = await fetchWorkCyclesFromFulfilAPI();
    console.log(`✅ Fetched ${workCycles.length} work cycles`);
    
    // Import each cycle
    let importedCount = 0;
    let skippedCount = 0;
    
    for (const cycle of workCycles) {
      try {
        const { woNumber, moNumber } = parseRecName(cycle.rec_name);
        const workCenterCategory = getWorkCenterCategory(cycle.work_cycles_work_center_rec_name);
        
        // Duration is already in seconds from API
        const durationSeconds = cycle.production_work_cycles_duration || 0;
        
        if (durationSeconds <= 0) {
          skippedCount++;
          continue;
        }
        
        await db.execute(sql`
          INSERT INTO work_cycles (
            work_cycles_id,
            work_cycles_duration,
            work_cycles_rec_name,
            work_cycles_operator_rec_name,
            work_cycles_work_center_rec_name,
            work_cycles_quantity_done,
            work_production_id,
            work_production_number,
            work_production_routing_rec_name,
            work_rec_name,
            work_operation_rec_name,
            work_id,
            state,
            data_corrupted,
            work_production_quantity,
            work_production_create_date,
            work_production_planned_date,
            work_production_priority
          ) VALUES (
            ${cycle.production_work_cycles_id},
            ${durationSeconds},
            ${cycle.rec_name},
            ${cycle.operator_rec_name},
            ${workCenterCategory},
            ${cycle.production_quantity},
            ${cycle.production},
            ${moNumber},
            ${cycle.production_routing_rec_name},
            ${cycle.rec_name},
            ${cycle.work_operation_rec_name},
            ${cycle.id},
            ${cycle.state},
            FALSE,
            ${cycle.production_quantity},
            ${cycle.create_date},
            ${cycle.production_planned_date},
            ${cycle.production_priority}
          )
          ON CONFLICT DO NOTHING
        `);
        
        importedCount++;
        
        if (importedCount % 100 === 0) {
          console.log(`📥 Imported ${importedCount} cycles...`);
        }
        
      } catch (error) {
        console.error(`❌ Error importing cycle ${cycle.id}:`, error);
        skippedCount++;
      }
    }
    
    console.log(`\n✅ Import complete: ${importedCount} imported, ${skippedCount} skipped`);
    
    // Verify the data
    await verifyImportedData();
    
  } catch (error) {
    console.error("❌ Import failed:", error);
  }
}

async function verifyImportedData() {
  console.log("\n🔍 Verifying imported data...");
  
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_cycles,
      COUNT(DISTINCT work_production_number) as unique_mos,
      COUNT(DISTINCT work_cycles_operator_rec_name) as unique_operators,
      COUNT(DISTINCT work_cycles_work_center_rec_name) as unique_work_centers,
      AVG(work_cycles_duration) as avg_duration_seconds,
      MIN(work_cycles_duration) as min_duration,
      MAX(work_cycles_duration) as max_duration
    FROM work_cycles
  `);
  
  const result = stats.rows[0];
  console.log(`✅ Total Cycles: ${result.total_cycles}`);
  console.log(`✅ Unique MOs: ${result.unique_mos}`);
  console.log(`✅ Unique Operators: ${result.unique_operators}`);
  console.log(`✅ Unique Work Centers: ${result.unique_work_centers}`);
  console.log(`📊 Average Duration: ${Math.round(result.avg_duration_seconds as number)}s`);
  console.log(`📊 Duration Range: ${result.min_duration}s - ${result.max_duration}s`);
  
  // Check specific MO
  const mo23577 = await db.execute(sql`
    SELECT 
      work_cycles_work_center_rec_name as work_center,
      COUNT(*) as cycle_count,
      SUM(work_cycles_duration) as total_seconds,
      ROUND(CAST(SUM(work_cycles_duration) / 3600.0 AS NUMERIC), 2) as total_hours
    FROM work_cycles 
    WHERE work_production_number = 'MO23577'
    GROUP BY work_cycles_work_center_rec_name
  `);
  
  console.log("\n📋 MO23577 Work Center Breakdown:");
  for (const row of mo23577.rows) {
    console.log(`   ${row.work_center}: ${row.total_seconds}s (${row.total_hours}h)`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importWorkCyclesFromFulfilAPI();
}

export { importWorkCyclesFromFulfilAPI };