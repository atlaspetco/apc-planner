# UPH Calculation Fix - Accurate MO-Based Calculation

## Problem Identified

The previous UPH calculations were **inaccurate** because they were summing work cycle quantities instead of using the Manufacturing Order (MO) quantity. This led to incorrect UPH values.

### Example of the Issue:
- **MO123** has a quantity of **100 units**
- It has 3 work cycles:
  - Cycle 1: 30 units done in 3 hours
  - Cycle 2: 40 units done in 4 hours  
  - Cycle 3: 30 units done in 3 hours

**❌ WRONG calculation (previous method):**
- Total cycle quantity = 30 + 40 + 30 = 100 units
- Total time = 3 + 4 + 3 = 10 hours
- UPH = 100 / 10 = 10 UPH

**✅ CORRECT calculation (new method):**
- MO quantity = 100 units (from production order)
- Total time = 3 + 4 + 3 = 10 hours
- UPH = 100 / 10 = 10 UPH

In this example both happen to be the same, but often work cycles record partial quantities or multiple cycles are needed, leading to significant calculation errors.

## Solution Implemented

### 1. New Accurate UPH Calculation (`server/accurate-uph-calculation.ts`)

The new calculation follows your exact specification:

```typescript
// Step 1: Extract completed work cycles with MO quantities
SELECT 
  work_production_quantity as mo_quantity,  -- MO quantity, not cycle quantity
  work_cycles_duration as duration_seconds,
  // ... other fields
FROM work_cycles 
WHERE state = 'done'

// Step 2: Group by Operator + Work Center + Routing + MO
// Step 3: Calculate UPH per MO = MO Quantity / Total Duration
// Step 4: Average UPH across MOs for each combination
```

### 2. Updated API Endpoints

- **`POST /api/uph/calculate`** - Now uses the accurate calculation
- **`GET /api/uph/table-data`** - Updated to display data from `historicalUph` table
- **`GET /api/uph/historical`** - Returns the accurate UPH data

### 3. Key Changes

1. **Uses MO Quantity**: Fetches `work_production_quantity` instead of summing `work_cycles_quantity_done`
2. **Groups by MO**: Ensures all work cycles for an MO are combined before calculating UPH
3. **Averages Correctly**: Calculates UPH per MO first, then averages across MOs
4. **Stores in Historical Table**: Uses the `historicalUph` table for consistency

## Impact on Dashboard

When users click "Calculate UPH" in:
- **UPH Analytics page** - Will now show accurate UPH values
- **Fulfil Settings page** - Will calculate correct performance metrics
- **Operator dropdowns** - Will display accurate time estimates

## Example Results

For operator "Mark Neiderer" working on "Lifetime Harness" in Assembly:
- **Before**: Might show 15.3 UPH (incorrect, based on summed cycle quantities)
- **After**: Shows 12.5 UPH (correct, based on actual MO quantities)

This provides more accurate:
- Production time estimates
- Operator scheduling
- Capacity planning
- Performance tracking

## Testing

To verify the fix works:
1. Click "Calculate UPH" in the UPH Analytics page
2. Check that UPH values are reasonable (typically 5-50 UPH for manual operations)
3. Verify that operator time estimates in work order assignments make sense
4. Cross-reference with known production rates

The fix ensures that UPH calculations accurately reflect real production performance by using the correct MO quantities.