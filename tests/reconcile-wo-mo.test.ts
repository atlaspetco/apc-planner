import { describe, it, expect } from 'vitest';
import { rebuildWorkOrderData } from '../server/reconcile-wo-mo';

// Simple unit test with mocked API service
class MockAPI {
  getWorkOrders() {
    return Promise.resolve([
      { id: 10, production: 100, quantity_done: 40, rec_name: 'WO10 | Assembly | MO100' }
    ]);
  }
  getWorkCycles() {
    return Promise.resolve([
      { id: 1, duration: 3600, quantity_done: 40, work: { id: 10, production: { id: 100 } } }
    ]);
  }
  setApiKey() {}
}

describe('rebuildWorkOrderData', () => {
  it('aggregates cycles per work order correctly', async () => {
    const service = new MockAPI() as any;
    const summaries = await rebuildWorkOrderData(service);
    expect(summaries[0].woId).toBe(10);
    expect(summaries[0].moId).toBe(100);
    expect(summaries[0].totalDurationHours).toBeCloseTo(1);
    expect(summaries[0].uph).toBe(40);
  });
});
