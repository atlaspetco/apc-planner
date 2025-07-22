/**
 * Work Center Category Mapping Utility
 * Maps raw work center names to canonical categories
 */

export type WorkCenterCategory = 'Cutting' | 'Assembly' | 'Packaging';

/**
 * Map work center names to canonical categories
 * - Cutting: includes cutting, laser, webbing operations
 * - Assembly: merges Rope, Sewing, Embroidery operations
 * - Packaging: includes packaging and pack operations
 */
export function mapWorkCenterToCategory(workCenterName: string): WorkCenterCategory | null {
  if (!workCenterName) return null;
  
  const normalized = workCenterName.toLowerCase().trim();
  
  // Cutting category
  if (normalized.includes('cutting') || 
      normalized.includes('cut') || 
      normalized.includes('laser') || 
      normalized.includes('webbing')) {
    return 'Cutting';
  }
  
  // Assembly category (merge Rope + Sewing + Embroidery)
  if (normalized.includes('sewing') || 
      normalized.includes('assembly') || 
      normalized.includes('rope') || 
      normalized.includes('embroidery') ||
      normalized.includes('grommet') ||
      normalized.includes('zipper')) {
    return 'Assembly';
  }
  
  // Packaging category
  if (normalized.includes('packaging') || 
      normalized.includes('pack') ||
      normalized.includes('snap') ||
      normalized.includes('final')) {
    return 'Packaging';
  }
  
  // Return null for unmatched work centers
  return null;
}

/**
 * Get all canonical work center categories
 */
export function getAllCategories(): WorkCenterCategory[] {
  return ['Cutting', 'Assembly', 'Packaging'];
}

/**
 * Check if a work center name maps to a valid category
 */
export function isValidCategory(workCenterName: string): boolean {
  return mapWorkCenterToCategory(workCenterName) !== null;
}