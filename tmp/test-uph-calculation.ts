import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import * as schema from "./shared/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sqlClient = neon(databaseUrl);
const db = drizzle(sqlClient, { schema });

async function testUphCalculation() {
  // Get all work cycles for Courtney Banh + Assembly + Lifetime Pouch
  const cycles = await db.execute(sql`
    SELECT 
      work_production_id,
      work_production_quantity,
      SUM(work_cycles_duration) as total_duration_seconds,
      COUNT(*) as cycle_count,
      (work_production_quantity::float / (SUM(work_cycles_duration) / 3600.0)) as calculated_uph
    FROM work_cycles
    WHERE work_cycles_operator_rec_name = 'Courtney Banh'
      AND work_cycles_work_center_rec_name IN ('Assembly', 'Sewing', 'Rope', 'Sewing / Assembly', 'Rope / Assembly')
      AND work_production_routing_rec_name = 'Lifetime Pouch'
      AND work_cycles_duration >= 120  -- At least 2 minutes
    GROUP BY work_production_id, work_production_quantity
    HAVING (work_production_quantity::float / (SUM(work_cycles_duration) / 3600.0)) <= 500
    ORDER BY calculated_uph DESC
  `);

  console.log("\n🔍 UPH Calculation Test for Courtney Banh - Assembly - Lifetime Pouch");
  console.log("======================================================================");
  
  // Find 40-unit MOs
  const fortyUnitMos = cycles.rows.filter(row => row.work_production_quantity === 40);
  
  console.log("\n📦 40-Unit MOs:");
  fortyUnitMos.forEach(mo => {
    const hours = (mo.total_duration_seconds as number) / 3600;
    console.log(`  MO ${mo.work_production_id}: ${mo.work_production_quantity} units / ${hours.toFixed(2)} hrs = ${(mo.calculated_uph as number).toFixed(2)} UPH`);
  });
  
  // Calculate average UPH
  const validUphValues = cycles.rows.map(row => row.calculated_uph as number);
  const averageUph = validUphValues.reduce((sum, uph) => sum + uph, 0) / validUphValues.length;
  
  console.log("\n📊 Summary:");
  console.log(`  - Total MOs: ${cycles.rows.length}`);
  console.log(`  - Average UPH: ${averageUph.toFixed(2)}`);
  console.log(`  - Min UPH: ${Math.min(...validUphValues).toFixed(2)}`);
  console.log(`  - Max UPH: ${Math.max(...validUphValues).toFixed(2)}`);
  
  console.log("\n📈 Top 10 UPH Values:");
  cycles.rows.slice(0, 10).forEach(mo => {
    const hours = (mo.total_duration_seconds as number) / 3600;
    console.log(`  MO ${mo.work_production_id}: ${mo.work_production_quantity} units / ${hours.toFixed(2)} hrs = ${(mo.calculated_uph as number).toFixed(2)} UPH`);
  });
}

testUphCalculation().catch(console.error);