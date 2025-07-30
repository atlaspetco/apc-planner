#!/usr/bin/env tsx

/**
 * Debug the assignments API to see what completed hours are being returned
 */

import { db } from "./server/db.js";
import { assignments, operators } from "./shared/schema.js";
import { eq } from "drizzle-orm";

async function debugAssignmentsApi() {
  console.log("=== Debug Assignments API Completed Hours ===");
  
  // Get some sample assignments from database
  const dbAssignments = await db
    .select()
    .from(assignments)
    .limit(10);
  
  console.log(`\nFound ${dbAssignments.length} assignments in database`);
  
  // Check if any have completed hours
  for (const assignment of dbAssignments) {
    if (assignment.operatorId) {
      const operator = await db.select().from(operators).where(eq(operators.id, assignment.operatorId)).limit(1);
      const operatorName = operator[0]?.name || 'Unknown';
      
      console.log(`Assignment ${assignment.id}: Operator=${operatorName}, WO=${assignment.workOrderId}, CompletedHours=${assignment.completedHours || 'NULL'}`);
    }
  }
  
  // Check what operators exist
  console.log("\n=== Operators in Database ===");
  const allOperators = await db.select().from(operators);
  allOperators.forEach(op => {
    console.log(`ID: ${op.id}, Name: ${op.name}`);
  });
  
  // Test the API endpoint logic manually
  console.log("\n=== Test Manual API Logic ===");
  
  // Simple test: make a direct HTTP request to assignments API to see raw response
  try {
    console.log("Testing assignments API endpoint...");
    console.log("Note: This will fail due to authentication, but that's expected");
    
    // Let's manually check what the dashboardCompletedHoursByOperator would contain
    // by reproducing the exact logic from routes.ts
    
  } catch (error) {
    console.log("Expected auth error:", error);
  }
}

debugAssignmentsApi().catch(console.error);