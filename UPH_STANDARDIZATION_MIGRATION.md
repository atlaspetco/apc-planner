# UPH Standardization Migration Guide

## Overview

This migration guide outlines the changes made to standardize UPH (Units Per Hour) calculations across the application. The new system ensures consistency between the planning grid and analytics page by using a unified calculation method.

## Key Changes

### 1. New Key Dimensions

**Old System:**
- Key: `(routing, operation, operator)`
- Aggregated total duration/quantity across all MOs
- Inconsistent results between grid and analytics

**New System:**
- Key: `(product_name, work_center_category, operator_id)`
- MO-first calculation approach
- Consistent results across all views

### 2. Work Center Category Mapping

All work centers are now mapped to three canonical categories:
- **Cutting**: includes cutting, laser, webbing operations
- **Assembly**: merges Rope, Sewing, Embroidery, Grommet, Zipper operations
- **Packaging**: includes packaging, pack, snap, final operations

### 3. MO-First Calculation Algorithm

```
1. Filter work cycles: state='done' AND start_date >= (today - window_days)
2. Join with production orders to get product name and MO quantity
3. For each unique MO:
   - Group cycles by category
   - Sum duration_seconds
   - Calculate: UPH_MO = MO_Quantity / (Total_Duration_Hours)
4. Average UPH across MOs for final result
```

### 4. Rolling Window Support

The system now supports three time windows:
- 7 days (weekly view)
- 30 days (monthly view - default)
- 180 days (6-month historical view)

## API Changes

### New Endpoints

#### Get Standardized UPH Data
```
GET /api/uph/standardized?productName=<name>&workCenterCategory=<category>&operatorId=<id>&windowDays=<7|30|180>
```

#### Get Operator-Specific UPH
```
GET /api/uph/standardized/operator/:operatorId?productName=<name>&workCenterCategory=<category>&windowDays=<7|30|180>
```

#### Trigger Manual Calculation
```
POST /api/uph/standardized/calculate
```

#### Check Job Status
```
GET /api/uph/standardized/job-status
```

### Updated Endpoints

The `/api/operators/qualified` endpoint now:
- Accepts `productName` parameter
- Uses standardized UPH calculation
- Returns operators with performance data for the specific product/category combination

## Frontend Changes

### New React Hook

```typescript
import { useStandardizedUph } from '@/hooks/useStandardizedUph';

// Usage
const { data, isLoading } = useStandardizedUph({
  productName: 'Lifetime Harness',
  workCenterCategory: 'Assembly',
  operatorId: 101,
  windowDays: 30
});
```

### UPH Analytics Page

The analytics page now:
- Uses standardized UPH data
- Includes a window days selector (7/30/180 days)
- Shows MO-based calculations
- Displays consistent data with the planning grid

## Migration Steps

### 1. Deploy Backend Changes

1. Deploy the new service files:
   - `server/services/uphService.ts`
   - `server/utils/categoryMap.ts`
   - `server/jobs/uphCron.ts`

2. Deploy updated routes with new endpoints

3. The cron job will automatically start calculating standardized UPH data

### 2. Update Frontend

1. Deploy the new hook: `client/src/hooks/useStandardizedUph.ts`

2. Update components to use the new hook instead of direct API calls

3. Add window days selector to relevant UI components

### 3. Data Migration

The system will automatically calculate new UPH values when:
- The cron job runs (every 6 hours)
- Manual calculation is triggered via API
- Data is requested via the standardized endpoints

No manual data migration is required as calculations are done on-demand.

## Monitoring

### Check Calculation Status

```bash
curl http://localhost:5000/api/uph/standardized/job-status
```

### Trigger Manual Calculation

```bash
curl -X POST http://localhost:5000/api/uph/standardized/calculate
```

### View Standardized Data

```bash
curl "http://localhost:5000/api/uph/standardized?windowDays=30"
```

## Rollback Plan

If issues arise:

1. The old endpoints remain functional (deprecated but not removed)
2. Frontend can be reverted to use old endpoints
3. No data loss as calculations are done on-demand

## Benefits

1. **Consistency**: Grid and analytics show identical UPH values
2. **Accuracy**: MO-specific calculations better reflect actual performance
3. **Flexibility**: Support for different time windows
4. **Performance**: Redis caching reduces calculation overhead
5. **Maintainability**: Single source of truth for UPH calculations

## Support

For questions or issues with the migration:
1. Check job status endpoint for calculation errors
2. Review server logs for detailed error messages
3. Verify work cycles have proper `state='done'` and date values
4. Ensure production orders have product names populated