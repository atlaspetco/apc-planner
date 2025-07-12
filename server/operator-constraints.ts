import { db } from "./db.js";
import { historicalUph, operators } from "../shared/schema.js";
import { eq, and } from "drizzle-orm";

export interface OperatorConstraint {
  operatorId: number;
  operatorName: string;
  workCenter: string;
  routing: string;
  avgUph: number;
  observations: number;
}

/**
 * Get operators who can work on a specific work center and routing combination
 * based on their historical UPH performance data
 */
export async function getQualifiedOperators(workCenter: string, routing: string): Promise<OperatorConstraint[]> {
  try {
    // Get all operators who have historical UPH data for this work center and routing
    const qualifiedOperators = await db
      .select({
        operatorName: historicalUph.operator,
        workCenter: historicalUph.workCenter,
        routing: historicalUph.routing,
        avgUph: historicalUph.unitsPerHour,
        observations: historicalUph.observations,
      })
      .from(historicalUph)
      .where(
        and(
          eq(historicalUph.workCenter, workCenter),
          eq(historicalUph.routing, routing)
        )
      )
      .orderBy(historicalUph.unitsPerHour); // Order by UPH performance
    
    // Get operator IDs from the operators table
    const operatorsWithIds = [];
    for (const constraint of qualifiedOperators) {
      const operatorRecord = await db
        .select()
        .from(operators)
        .where(eq(operators.name, constraint.operatorName))
        .limit(1);
      
      if (operatorRecord.length > 0) {
        operatorsWithIds.push({
          operatorId: operatorRecord[0].id,
          operatorName: constraint.operatorName,
          workCenter: constraint.workCenter,
          routing: constraint.routing,
          avgUph: constraint.avgUph,
          observations: constraint.observations,
        });
      }
    }
    
    console.log(`Found ${operatorsWithIds.length} qualified operators for ${workCenter} - ${routing}`);
    return operatorsWithIds;
  } catch (error) {
    console.error(`Error getting qualified operators for ${workCenter} - ${routing}:`, error);
    return [];
  }
}

/**
 * Get all work center and routing combinations an operator can work on
 */
export async function getOperatorCapabilities(operatorName: string): Promise<Array<{workCenter: string, routing: string, avgUph: number}>> {
  try {
    const capabilities = await db
      .select({
        workCenter: historicalUph.workCenter,
        routing: historicalUph.routing,
        avgUph: historicalUph.unitsPerHour,
      })
      .from(historicalUph)
      .where(eq(historicalUph.operator, operatorName))
      .orderBy(historicalUph.workCenter, historicalUph.routing);
    
    return capabilities;
  } catch (error) {
    console.error(`Error getting capabilities for operator ${operatorName}:`, error);
    return [];
  }
}

/**
 * Check if an operator is qualified for a specific work center and routing
 */
export async function isOperatorQualified(operatorName: string, workCenter: string, routing: string): Promise<boolean> {
  try {
    const qualification = await db
      .select()
      .from(historicalUph)
      .where(
        and(
          eq(historicalUph.operator, operatorName),
          eq(historicalUph.workCenter, workCenter),
          eq(historicalUph.routing, routing)
        )
      )
      .limit(1);
    
    return qualification.length > 0;
  } catch (error) {
    console.error(`Error checking qualification for ${operatorName} - ${workCenter} - ${routing}:`, error);
    return false;
  }
}