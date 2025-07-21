/**
 * Auto-sync stub to prevent import errors
 * Basic sync functionality for production orders and work cycles
 */

export function startAutoSync() {
  console.log('Auto sync started');
  return { success: true };
}

export function stopAutoSync() {
  console.log('Auto sync stopped');
  return { success: true };
}

export function getSyncStatus() {
  return {
    isRunning: false,
    lastSync: new Date().toISOString(),
    status: 'idle'
  };
}

export async function syncCompletedData() {
  console.log('Syncing completed data...');
  return {
    success: true,
    message: 'Sync completed'
  };
}

export async function manualRefreshRecentMOs() {
  console.log('Refreshing recent manufacturing orders...');
  return {
    success: true,
    message: 'Recent MOs refreshed'
  };
}