// Test script to debug auto-assign functionality
import { autoAssignWorkOrders } from './server/ai-auto-assign.js';

console.log('🧪 Testing auto-assign functionality...');

try {
  const result = await autoAssignWorkOrders();
  console.log('🎉 Auto-assign result:', {
    success: result.success,
    assignments: result.assignments.length,
    unassigned: result.unassigned.length,
    summary: result.summary,
    totalHoursOptimized: result.totalHoursOptimized
  });
  
  if (result.workCenterResults) {
    console.log('📊 Work center results:');
    for (const wc of result.workCenterResults) {
      console.log(`  ${wc.workCenter}: ${wc.success ? '✅' : '❌'} (${wc.assignedCount}/${wc.workOrderCount})`);
      if (wc.error) console.log(`    Error: ${wc.error}`);
    }
  }
  
} catch (error) {
  console.error('❌ Auto-assign test failed:', error.message);
  console.error(error.stack);
}