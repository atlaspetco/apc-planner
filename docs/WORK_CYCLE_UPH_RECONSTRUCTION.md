# Work Cycle & UPH Reconciliation Plan

## Audit Summary
- **Current Join Logic**: work cycles link to work orders via `work_id`, and work orders link to manufacturing orders through `production`.
- **Observed Issues**: mismatched MO IDs and quantities due to cycles being attached to the wrong work order or MO, stale records, and duplicate cycle IDs.
- **Failure Points**
  1. `rec_name` parsing can mis-identify the work center or MO when the format changes.
  2. Cycles imported without `work_production_id` cause WO → MO mapping to be guessed instead of read from the API.
  3. Duration is sometimes aggregated across unrelated work orders when cycle IDs are duplicated.

## Robust Approach
1. **Fetch ground truth from Fulfil**
   - `getWorkOrders()` to retrieve all WOs with `id`, `production`, `quantity_done` and `rec_name`.
   - `getWorkCycles()` to retrieve cycles with `id`, `duration`, `quantity_done`, `work.id`, and `work.production.id`.
2. **Group cycles by work order**
   - Only use `cycle.work.id` as the key.
   - Sum `duration` for all cycles in that work order.
   - Verify all cycles reference the same `work.production.id`; flag if multiple MOs appear.
3. **Reconcile with work orders**
   - For each WO from step 1, look up the grouped cycle data.
   - Compare the WO's `production` field to the MO ID collected from cycles.
   - Store `totalDurationHours`, `totalQuantity` and compute `UPH` as `quantity / hours`.
4. **Validation step**
   - Any mismatch in MO ID, quantity, or duration between DB and API is logged and returned for inspection.
   - Stale work orders (missing from the API) are reported but not shown in the UI.
5. **Defensive Logging**
   - When mismatches are detected, log WO number, expected MO, actual MO, duration, and quantity.
   - Store a summary table of mismatches for quick review.

## Pseudocode of New Pipeline
```ts
async function rebuildWorkCycleData() {
  const api = new FulfilAPIService(process.env.FULFIL_URL);
  api.setApiKey(process.env.FULFIL_ACCESS_TOKEN!);

  const apiWOs = await api.getWorkOrders('done', 1000);
  const apiCycles = await api.getWorkCycles({ state: 'done', limit: 10000 });

  // 1. Map work orders by ID
  const woMap = new Map<number, FulfilWorkOrder>();
  for (const wo of apiWOs) {
    woMap.set(wo.id, wo);
  }

  // 2. Group cycles strictly by work order ID
  const cycleGroups = new Map<number, { moId: number; duration: number; qty: number }>();
  for (const c of apiCycles) {
    const woId = c.work?.id;
    if (!woId) continue;
    const group = cycleGroups.get(woId) || { moId: c.work?.production?.id || 0, duration: 0, qty: 0 };
    group.duration += c.duration;
    if (c.quantity_done) group.qty += c.quantity_done;
    cycleGroups.set(woId, group);
  }

  // 3. Build final summaries and compare
  const summaries = [] as WorkOrderSummary[];
  for (const [woId, group] of cycleGroups) {
    const wo = woMap.get(woId);
    const moId = wo?.production || group.moId;
    const hours = group.duration / 3600;
    const quantity = group.qty || wo?.quantity_done || 0;
    const uph = hours > 0 ? quantity / hours : 0;

    if (wo && wo.production !== moId) {
      console.warn(`WO${woId} linked to MO${wo.production} but cycles show MO${moId}`);
    }

    summaries.push({ woId, moId, totalDurationHours: hours, totalQuantity: quantity, uph });
  }

  return summaries;
}
```
This routine guarantees each WO’s totals come directly from the Fulfil API and exposes mismatches whenever the database diverges from the API.
