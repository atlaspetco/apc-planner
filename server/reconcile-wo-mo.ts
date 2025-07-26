import { FulfilAPIService } from './fulfil-api.js';
import { db } from './db.js';
import { workOrders } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

export interface WorkOrderSummary {
  woId: number;
  moId: number;
  totalDurationHours: number;
  totalQuantity: number;
  uph: number;
}

/**
 * Rebuild work order totals directly from Fulfil API.
 * - Groups all cycles by `work.id`.
 * - Validates MO mapping and duration against the API.
 */
export async function rebuildWorkOrderData(apiService?: FulfilAPIService): Promise<WorkOrderSummary[]> {
  const api = apiService || new FulfilAPIService();
  api.setApiKey(process.env.FULFIL_ACCESS_TOKEN || '');

  // Fetch base work orders and cycles
  const apiWOs = await api.getWorkOrders('done', 1000);
  const apiCycles = await api.getWorkCycles({ state: 'done', limit: 10000 });

  const woMap = new Map<number, typeof apiWOs[number]>();
  for (const wo of apiWOs) {
    woMap.set(wo.id, wo);
  }

  const cycleGroups = new Map<number, { moId: number; duration: number; qty: number }>();
  for (const c of apiCycles) {
    const woId = (c as any).work?.id as number | undefined;
    if (!woId) continue;
    const group = cycleGroups.get(woId) || { moId: (c as any).work?.production?.id || 0, duration: 0, qty: 0 };
    group.duration += c.duration || 0;
    if ((c as any).quantity_done) {
      group.qty += (c as any).quantity_done as number;
    }
    cycleGroups.set(woId, group);
  }

  const summaries: WorkOrderSummary[] = [];

  for (const [woId, group] of cycleGroups) {
    const wo = woMap.get(woId);
    const moId = wo?.production || group.moId;
    const hours = group.duration / 3600;
    const quantity = group.qty || (wo?.quantity_done as number | undefined) || 0;
    const uph = hours > 0 ? quantity / hours : 0;

    if (wo && wo.production !== moId) {
      console.warn(`WO${woId} mapped to MO${wo.production} but cycles show MO${moId}`);
    }

    summaries.push({ woId, moId, totalDurationHours: hours, totalQuantity: quantity, uph });
  }

  // Optional: persist summaries
  for (const s of summaries) {
    await db.update(workOrders)
      .set({ totalCycleDuration: Math.round(s.totalDurationHours * 3600), quantityDone: s.totalQuantity })
      .where(eq(workOrders.id, s.woId));
  }

  return summaries;
}
