import type {
  JSONRPCError,
  JSONRPCMessage,
  Message,
  Part,
  TextPart,
  DataPart,
  Task,
  TaskStatus,
  Artifact,
  TaskState,
} from "../types"; // Import A2A types
import { isTextPart, isDataPart } from "../types"; // Import type guards
import { logger } from "../../utils/logger"; // Use core logger

/**
 * Creates a standard JSON-RPC error response object.
 */
export function createJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): { jsonrpc: "2.0"; id: any; error: JSONRPCError } {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      // Ensure data is serializable and does not expose sensitive info
      // Convert Errors to string message, otherwise include provided data
      data:
        data instanceof Error
          ? data.message
          : typeof data !== "undefined"
            ? data
            : null,
    },
  };
}

/**
 * Finds the text content of the first TextPart in a message.
 */
export function getFirstTextPart(message: Message): string | undefined {
  const textPart = message.parts.find(isTextPart);
  return textPart?.text;
}

/**
 * Constructs the final A2A Task object for a tasks/send response.
 * @param taskId The task ID.
 * @param state The final TaskState ('completed', 'failed', etc.).
 * @param finalAgentMsg The final message from the agent.
 * @param finalHistory The complete task history.
 * @param artifacts The list of artifacts collected during the run.
 * @param metadata Optional task-level metadata.
 * @returns The A2A Task object.
 */
export function createTaskResponse(
  taskId: string,
  state: TaskState,
  finalAgentMsg: Message | null, // Allow null for failed tasks if no message could be composed
  finalHistory: Message[],
  artifacts: Artifact[],
  metadata?: Record<string, unknown> | null,
): Task {
  const taskStatus: TaskStatus = {
    state,
    message: finalAgentMsg, // Include the final agent message here
    // Use current time for the final status timestamp, or potentially the timestamp from the last step
    timestamp: new Date().toISOString(),
  };

  return {
    id: taskId, // A2A task ID
    status: taskStatus,
    artifacts: artifacts, // Populate artifacts from the collected list
    history: finalHistory, // Include the full message history
    metadata: metadata || {}, // Include optional metadata
  };
}
