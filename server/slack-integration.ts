import { WebClient } from "@slack/web-api";
import { db } from "./db";
import { operators } from "../shared/schema";
import { eq } from "drizzle-orm";

// Initialize Slack client (will be enabled when secrets are provided)
let slackClient: WebClient | null = null;

if (process.env.SLACK_BOT_TOKEN) {
  slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
}

/**
 * Send a message to an operator via Slack
 * @param operatorId - Database ID of the operator
 * @param message - Message to send
 * @returns Promise resolving to success status
 */
export async function sendMessageToOperator(operatorId: number, message: string): Promise<boolean> {
  try {
    if (!slackClient) {
      console.warn("Slack integration not configured - SLACK_BOT_TOKEN missing");
      return false;
    }

    // Get operator's Slack User ID
    const [operator] = await db
      .select()
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);

    if (!operator || !operator.slackUserId) {
      console.warn(`Operator ${operatorId} has no Slack User ID configured`);
      return false;
    }

    // Send direct message to operator
    await slackClient.chat.postMessage({
      channel: operator.slackUserId,
      text: message,
    });

    console.log(`Successfully sent message to operator ${operator.name} (${operator.slackUserId})`);
    return true;
  } catch (error) {
    console.error("Error sending Slack message:", error);
    return false;
  }
}

/**
 * Send work assignment notification to an operator
 * @param operatorId - Database ID of the operator
 * @param workOrderDetails - Details about the work order assignment
 */
export async function notifyWorkAssignment(
  operatorId: number,
  workOrderDetails: {
    moNumber: string;
    workCenter: string;
    operation: string;
    quantity: number;
    estimatedHours?: number;
  }
): Promise<boolean> {
  const message = `🔔 New Work Assignment\n\n` +
    `MO: ${workOrderDetails.moNumber}\n` +
    `Work Center: ${workOrderDetails.workCenter}\n` +
    `Operation: ${workOrderDetails.operation}\n` +
    `Quantity: ${workOrderDetails.quantity} units\n` +
    `${workOrderDetails.estimatedHours ? `Estimated Time: ${workOrderDetails.estimatedHours.toFixed(1)} hours\n` : ''}` +
    `\nPlease check the production dashboard for details.`;

  return sendMessageToOperator(operatorId, message);
}

/**
 * Send UPH performance update to an operator
 * @param operatorId - Database ID of the operator
 * @param performanceData - Performance metrics
 */
export async function notifyPerformanceUpdate(
  operatorId: number,
  performanceData: {
    workCenter: string;
    currentUph: number;
    targetUph?: number;
    trend: 'improving' | 'declining' | 'stable';
  }
): Promise<boolean> {
  const trendEmoji = {
    improving: '📈',
    declining: '📉',
    stable: '📊'
  };

  const message = `${trendEmoji[performanceData.trend]} Performance Update\n\n` +
    `Work Center: ${performanceData.workCenter}\n` +
    `Current UPH: ${performanceData.currentUph.toFixed(1)}\n` +
    `${performanceData.targetUph ? `Target UPH: ${performanceData.targetUph.toFixed(1)}\n` : ''}` +
    `Trend: ${performanceData.trend}\n\n` +
    `Keep up the great work!`;

  return sendMessageToOperator(operatorId, message);
}

/**
 * Test Slack integration by sending a test message
 * @param slackUserId - Slack User ID to test with
 */
export async function testSlackIntegration(slackUserId: string): Promise<boolean> {
  try {
    if (!slackClient) {
      throw new Error("Slack integration not configured - SLACK_BOT_TOKEN missing");
    }

    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: "🧪 Test message from Production Planning Dashboard\n\nSlack integration is working correctly!",
    });

    return true;
  } catch (error) {
    console.error("Slack integration test failed:", error);
    return false;
  }
}