/**
 * Utilities for parsing Fulfil rec_name fields to extract WO# and MO# information
 * This is the critical link between WorkCycles API and Work Orders API
 */

export interface ParsedRecName {
  workOrderNumber?: string;
  manufacturingOrderNumber?: string;
  operation?: string;
  workCenter?: string;
  fullRecName: string;
}

/**
 * Parses a rec_name field to extract work order and manufacturing order information
 * Examples of rec_name formats from Fulfil:
 * - "WO12345 - Assembly | MO67890"
 * - "Assembly - Webbing | MO67890"
 * - "Cutting - Fabric | Courtney Banh | MO67890"
 */
export function parseRecName(recName: string): ParsedRecName {
  if (!recName) {
    return { fullRecName: recName || '' };
  }

  const result: ParsedRecName = {
    fullRecName: recName
  };

  // Split by pipe separator to get different components
  const parts = recName.split('|').map(part => part.trim());
  
  // Look for MO number in any part
  for (const part of parts) {
    const moMatch = part.match(/MO(\d+)/i);
    if (moMatch) {
      result.manufacturingOrderNumber = `MO${moMatch[1]}`;
    }
  }

  // Look for WO number in any part
  for (const part of parts) {
    const woMatch = part.match(/WO(\d+)/i);
    if (woMatch) {
      result.workOrderNumber = `WO${woMatch[1]}`;
    }
  }

  // Extract operation and work center from the first part (usually contains operation info)
  if (parts.length > 0) {
    const operationPart = parts[0];
    
    // Common operation patterns
    if (operationPart.includes('Assembly')) {
      result.operation = 'Assembly';
      result.workCenter = 'Assembly';
    } else if (operationPart.includes('Cutting')) {
      result.operation = 'Cutting';
      result.workCenter = 'Cutting';
    } else if (operationPart.includes('Packaging')) {
      result.operation = 'Packaging';
      result.workCenter = 'Packaging';
    } else if (operationPart.includes('Sewing')) {
      result.operation = 'Sewing';
      result.workCenter = 'Assembly'; // Consolidate Sewing into Assembly
    } else if (operationPart.includes('Grommet')) {
      result.operation = 'Grommet';
      result.workCenter = 'Assembly';
    } else if (operationPart.includes('Zipper')) {
      result.operation = 'Zipper Pull';
      result.workCenter = 'Assembly';
    } else if (operationPart.includes('Engrave') || operationPart.includes('Laser')) {
      result.operation = 'Laser Engraving';
      result.workCenter = 'Cutting';
    }

    // If no specific operation found, use the whole first part
    if (!result.operation) {
      result.operation = operationPart;
      result.workCenter = 'Standard'; // fallback
    }
  }

  return result;
}

/**
 * Extracts all unique MO numbers from a list of rec_names
 */
export function extractMONumbers(recNames: string[]): string[] {
  const moNumbers = new Set<string>();
  
  for (const recName of recNames) {
    const parsed = parseRecName(recName);
    if (parsed.manufacturingOrderNumber) {
      moNumbers.add(parsed.manufacturingOrderNumber);
    }
  }
  
  return Array.from(moNumbers).sort();
}

/**
 * Extracts all unique WO numbers from a list of rec_names
 */
export function extractWONumbers(recNames: string[]): string[] {
  const woNumbers = new Set<string>();
  
  for (const recName of recNames) {
    const parsed = parseRecName(recName);
    if (parsed.workOrderNumber) {
      woNumbers.add(parsed.workOrderNumber);
    }
  }
  
  return Array.from(woNumbers).sort();
}

/**
 * Groups rec_names by their manufacturing order number
 */
export function groupByMO(recNames: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  
  for (const recName of recNames) {
    const parsed = parseRecName(recName);
    const mo = parsed.manufacturingOrderNumber || 'Unknown';
    
    if (!grouped[mo]) {
      grouped[mo] = [];
    }
    grouped[mo].push(recName);
  }
  
  return grouped;
}