// Environment variables are already loaded

const FULFIL_BASE_URL = "https://apc.fulfil.io";

async function testWorkCyclesDuration() {
  if (!process.env.FULFIL_ACCESS_TOKEN) {
    console.error("FULFIL_ACCESS_TOKEN not configured");
    return;
  }

  console.log("Testing production.work.cycle endpoint for duration data...\n");

  try {
    const response = await fetch(
      `${FULFIL_BASE_URL}/api/v2/model/production.work.cycle/search_read`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.FULFIL_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          filters: [["state", "=", "done"]],
          fields: [
            "id",
            "rec_name",
            "operator",
            "operator.rec_name",
            "work",
            "work.rec_name",
            "work.production",
            "work.production.rec_name",
            "work.production.routing.rec_name",
            "work.production.quantity",
            "work.operation.rec_name",
            "work_center",
            "work_center.rec_name",
            "duration",
            "quantity_done",
            "state",
            "start_time"
          ],
          limit: 5,
          order: [["id", "DESC"]],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error response:", errorText);
      return;
    }

    const data = await response.json();
    console.log(`Found ${data.length} work cycles with duration data\n`);

    // Display each work cycle with duration
    data.forEach((cycle: any, index: number) => {
      console.log(`Work Cycle ${index + 1}:`);
      console.log(`  ID: ${cycle.id}`);
      console.log(`  Rec Name: ${cycle.rec_name}`);
      console.log(`  Operator: ${cycle["operator.rec_name"] || "Unknown"}`);
      console.log(`  Work Center: ${cycle["work_center.rec_name"] || "Unknown"}`);
      console.log(`  Duration: ${cycle.duration?.seconds || 0} seconds`);
      console.log(`  Quantity Done: ${cycle.quantity_done || 0}`);
      console.log(`  Work Order: ${cycle["work.rec_name"] || "Unknown"}`);
      console.log(`  Production Order: ${cycle["work.production.rec_name"] || "Unknown"}`);
      console.log(`  Routing: ${cycle["work.production.routing.rec_name"] || "Unknown"}`);
      console.log(`  Operation: ${cycle["work.operation.rec_name"] || "Unknown"}`);
      
      // Calculate UPH if we have duration and quantity
      if (cycle.duration?.seconds && cycle.quantity_done) {
        const hours = cycle.duration.seconds / 3600;
        const uph = cycle.quantity_done / hours;
        console.log(`  Calculated UPH: ${uph.toFixed(2)} units/hour`);
      }
      
      console.log("\n");
    });

  } catch (error) {
    console.error("Error testing work cycles:", error);
  }
}

testWorkCyclesDuration();