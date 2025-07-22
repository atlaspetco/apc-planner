/**
 * Unit tests for Standardized UPH Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateStandardizedUph, getOperatorProductUph } from '../server/services/uphService';
import { mapWorkCenterToCategory } from '../server/utils/categoryMap';
import { db } from '../server/db';

// Mock database
vi.mock('../server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([]))
        }))
      }))
    }))
  }
}));

describe('Work Center Category Mapping', () => {
  it('should map cutting operations correctly', () => {
    expect(mapWorkCenterToCategory('Cutting')).toBe('Cutting');
    expect(mapWorkCenterToCategory('Laser Cutting')).toBe('Cutting');
    expect(mapWorkCenterToCategory('Webbing Cut')).toBe('Cutting');
    expect(mapWorkCenterToCategory('cutting fabric')).toBe('Cutting');
  });
  
  it('should map assembly operations correctly', () => {
    expect(mapWorkCenterToCategory('Sewing')).toBe('Assembly');
    expect(mapWorkCenterToCategory('Assembly Line')).toBe('Assembly');
    expect(mapWorkCenterToCategory('Rope Assembly')).toBe('Assembly');
    expect(mapWorkCenterToCategory('Embroidery Station')).toBe('Assembly');
    expect(mapWorkCenterToCategory('Grommet Press')).toBe('Assembly');
    expect(mapWorkCenterToCategory('Zipper Installation')).toBe('Assembly');
  });
  
  it('should map packaging operations correctly', () => {
    expect(mapWorkCenterToCategory('Packaging')).toBe('Packaging');
    expect(mapWorkCenterToCategory('Final Pack')).toBe('Packaging');
    expect(mapWorkCenterToCategory('Snap Installation')).toBe('Packaging');
  });
  
  it('should return null for unmapped work centers', () => {
    expect(mapWorkCenterToCategory('Unknown Station')).toBe(null);
    expect(mapWorkCenterToCategory('Quality Control')).toBe(null);
    expect(mapWorkCenterToCategory('')).toBe(null);
  });
});

describe('Standardized UPH Calculation', () => {
  const mockWorkCycles = [
    {
      cycleId: 1,
      operatorId: 101,
      operatorName: 'John Doe',
      workCenterName: 'Sewing Station 1',
      duration: 3600, // 1 hour
      quantityDone: 10,
      startDate: new Date('2024-01-15'),
      productionOrderNumber: 'MO-001',
      workOrderId: 1001,
      moQuantity: 100,
      productName: 'Lifetime Harness',
      moId: 2001,
      moNumber: 'MO-001'
    },
    {
      cycleId: 2,
      operatorId: 101,
      operatorName: 'John Doe',
      workCenterName: 'Rope Assembly',
      duration: 1800, // 0.5 hour
      quantityDone: 5,
      startDate: new Date('2024-01-15'),
      productionOrderNumber: 'MO-001',
      workOrderId: 1002,
      moQuantity: 100,
      productName: 'Lifetime Harness',
      moId: 2001,
      moNumber: 'MO-001'
    },
    {
      cycleId: 3,
      operatorId: 102,
      operatorName: 'Jane Smith',
      workCenterName: 'Cutting Table',
      duration: 2700, // 0.75 hour
      quantityDone: 15,
      startDate: new Date('2024-01-16'),
      productionOrderNumber: 'MO-002',
      workOrderId: 1003,
      moQuantity: 150,
      productName: 'Lifetime Leash',
      moId: 2002,
      moNumber: 'MO-002'
    }
  ];
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should calculate MO-first UPH correctly', async () => {
    // Mock database response
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockWorkCycles))
        }))
      }))
    } as any);
    
    const results = await calculateStandardizedUph({ windowDays: 30 });
    
    expect(results).toHaveLength(2);
    
    // Check John Doe's Assembly UPH for Lifetime Harness
    const johnResult = results.find(r => 
      r.operatorId === 101 && 
      r.workCenterCategory === 'Assembly' &&
      r.productName === 'Lifetime Harness'
    );
    
    expect(johnResult).toBeDefined();
    expect(johnResult?.averageUph).toBe(66.67); // 100 units / 1.5 hours
    expect(johnResult?.moCount).toBe(1);
    expect(johnResult?.totalObservations).toBe(2); // 2 cycles
    
    // Check Jane's Cutting UPH for Lifetime Leash
    const janeResult = results.find(r => 
      r.operatorId === 102 && 
      r.workCenterCategory === 'Cutting' &&
      r.productName === 'Lifetime Leash'
    );
    
    expect(janeResult).toBeDefined();
    expect(janeResult?.averageUph).toBe(200); // 150 units / 0.75 hours
    expect(janeResult?.moCount).toBe(1);
    expect(janeResult?.totalObservations).toBe(1);
  });
  
  it('should respect window days filter', async () => {
    const oldCycles = mockWorkCycles.map(c => ({
      ...c,
      startDate: new Date('2023-01-01') // Over a year ago
    }));
    
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(oldCycles))
        }))
      }))
    } as any);
    
    // Should filter out old cycles when using 7-day window
    const results = await calculateStandardizedUph({ windowDays: 7 });
    
    // Expect empty results since cycles are too old
    expect(results).toHaveLength(1);
    expect(results[0].dataAvailable).toBe(false);
    expect(results[0].message).toContain('No work cycles found');
  });
  
  it('should filter by product name correctly', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockWorkCycles))
        }))
      }))
    } as any);
    
    const results = await calculateStandardizedUph({ 
      productName: 'Lifetime Harness',
      windowDays: 30 
    });
    
    expect(results).toHaveLength(1);
    expect(results[0].productName).toBe('Lifetime Harness');
    expect(results[0].operatorId).toBe(101);
  });
  
  it('should filter by work center category correctly', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockWorkCycles))
        }))
      }))
    } as any);
    
    const results = await calculateStandardizedUph({ 
      workCenterCategory: 'Cutting',
      windowDays: 30 
    });
    
    expect(results).toHaveLength(1);
    expect(results[0].workCenterCategory).toBe('Cutting');
    expect(results[0].operatorId).toBe(102);
  });
  
  it('should handle multiple MOs for averaging', async () => {
    const multiMoCycles = [
      ...mockWorkCycles.slice(0, 2), // MO-001 cycles
      {
        cycleId: 4,
        operatorId: 101,
        operatorName: 'John Doe',
        workCenterName: 'Sewing Station 2',
        duration: 7200, // 2 hours
        quantityDone: 20,
        startDate: new Date('2024-01-17'),
        productionOrderNumber: 'MO-003',
        workOrderId: 1004,
        moQuantity: 120,
        productName: 'Lifetime Harness',
        moId: 2003,
        moNumber: 'MO-003'
      }
    ];
    
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(multiMoCycles))
        }))
      }))
    } as any);
    
    const results = await calculateStandardizedUph({ 
      operatorId: 101,
      productName: 'Lifetime Harness',
      windowDays: 30 
    });
    
    expect(results).toHaveLength(1);
    expect(results[0].moCount).toBe(2); // 2 MOs
    // Average UPH: (66.67 + 60) / 2 = 63.33
    expect(results[0].averageUph).toBeCloseTo(63.33, 1);
  });
  
  it('should filter out unrealistic UPH values', async () => {
    const unrealisticCycles = [
      {
        ...mockWorkCycles[0],
        duration: 1, // 1 second for 100 units = 360,000 UPH
        moQuantity: 100
      }
    ];
    
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(unrealisticCycles))
        }))
      }))
    } as any);
    
    const results = await calculateStandardizedUph({ windowDays: 30 });
    
    // Should filter out unrealistic UPH
    expect(results).toHaveLength(0);
  });
});

describe('Get Operator Product UPH', () => {
  it('should return specific operator UPH', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{
            cycleId: 1,
            operatorId: 101,
            operatorName: 'John Doe',
            workCenterName: 'Sewing Station',
            duration: 3600,
            quantityDone: 10,
            startDate: new Date('2024-01-15'),
            productionOrderNumber: 'MO-001',
            workOrderId: 1001,
            moQuantity: 100,
            productName: 'Lifetime Harness',
            moId: 2001,
            moNumber: 'MO-001'
          }]))
        }))
      }))
    } as any);
    
    const uph = await getOperatorProductUph(
      101, 
      'Lifetime Harness', 
      'Assembly', 
      30
    );
    
    expect(uph).toBe(100); // 100 units / 1 hour
  });
  
  it('should return null when no data available', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([]))
        }))
      }))
    } as any);
    
    const uph = await getOperatorProductUph(
      999, 
      'Unknown Product', 
      'Assembly', 
      30
    );
    
    expect(uph).toBe(null);
  });
});