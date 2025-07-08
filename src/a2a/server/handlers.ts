import type {
  SendTaskRequest,
  SendTaskResponse,
  SendTaskStreamingRequest,
  GetTaskRequest,
  GetTaskResponse,
  Message,
  Part,
  Task,
  TaskState,
  // JSONRPCRequest, // No longer need to import broad JSONRPCRequest here
  JSONRPCResponse,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Artifact,
  DataPart,
  TaskSendParams, // Import specific param types if needed for clarity, though Zod handles it
  TaskQueryParams,
} from "../types"; // Import A2A types
import {
  SendTaskRequestSchema,
  SendTaskStreamingRequestSchema,
  GetTaskRequestSchema,
} from "../validation"; // Import validation schemas
import { logger } from "../../utils/logger"; // Use core logger
import type { Persistence } from "../../utils/persistence"; // Import persistence type
import { sqlitePersistence } from "../../utils/persistence"; // Import default persistence
import type {
  A2AServerContext,
  SSEExpressResponse,
  TaskExecutionState,
} from "./types"; // Import server types
import { createJsonRpcError, createTaskResponse } from "./utils"; // Import server utilities
import { initializeOrLoadTaskState, runFlowAndPersist } from "./taskManager"; // Import task management functions
import { ZodError } from "zod"; // Import ZodError for validation handling
import { SharedState } from "../../core"; // Import SharedState

/**
 * Handles incoming A2A JSON-RPC requests.
 * This is the main entry point for the server logic.
 * Dispatches requests to appropriate method handlers.
 *
 * @param req The raw incoming request body.
 * @param context The A2AServerContext.
 * @param expressReq Optional Express request object (for context).
 * @param expressRes Optional Express response object (for streaming).
 * @returns A JSON-RPC response object, or undefined if streaming is handled via `expressRes`.
 */
export async function handleA2ARequest(
  req: any, // Raw request body
  context: A2AServerContext,
  expressReq?: any, // Use any for Express Request type to avoid direct Express dependency here
  expressRes?: any, // Use any for Express Response type
): Promise<JSONRPCResponse | undefined> {
  // Return type is JSONRPCResponse or undefined
  const persistence: Persistence = context.persistence || sqlitePersistence;
  const requestId = req?.id ?? null; // Get the JSON-RPC request ID
  const method = req?.method; // Capture method early for logging

  try {
    // Basic check for jsonrpc version and method existence
    if (req?.jsonrpc !== "2.0" || typeof method !== "string") {
      // Return an Invalid Request error if basic structure is wrong
      return createJsonRpcError(
        requestId,
        -32600,
        "Invalid Request",
        "Missing or invalid 'jsonrpc' version or 'method'.",
      );
    }

    // Validate the request based on its method using Zod schemas
    // Declare and assign validatedReq *within* the switch cases
    switch (method) {
      case "tasks/send":
        const validatedSendReq: SendTaskRequest =
          SendTaskRequestSchema.parse(req);
        return await handleSendTask(validatedSendReq, context, persistence);

      case "tasks/get":
        const validatedGetReq: GetTaskRequest = GetTaskRequestSchema.parse(req);
        return await handleGetTask(validatedGetReq, context, persistence);

      case "tasks/sendSubscribe":
        const validatedStreamReq: SendTaskStreamingRequest =
          SendTaskStreamingRequestSchema.parse(req);
        if (expressRes) {
          // Streaming requires the Express response object
          await handleSendSubscribe(
            validatedStreamReq,
            context,
            expressRes as SSEExpressResponse,
            persistence,
          );
          return undefined; // Response handled via SSE stream, do not send a JSON response here
        } else {
          // Cannot perform streaming without the HTTP response object (e.g., if called from a non-HTTP context)
          return createJsonRpcError(
            requestId ?? null,
            -32004, // Unsupported operation
            "Streaming requires an HTTP response context",
          );
        }

      // TODO: Add validation and handlers for other methods (cancel, pushNotification, etc.)

      default:
        // Method is a string, but not one of the supported methods
        return createJsonRpcError(
          requestId,
          -32601, // Method not found
          "Method not found",
        );
    }
  } catch (err) {
    // Catch validation errors (ZodError from .parse) or errors re-thrown by method handlers
    logger.error("[A2A Server] Request processing error:", {
      requestId,
      method: method, // Use the captured method name
      error: err instanceof Error ? err.stack : err,
      requestBody: req, // Log the request body for debugging
    });

    // Determine JSON-RPC error code and message
    let code = -32603; // Default to Internal error
    let message = "Internal error";
    let errorData: any = undefined;

    if (err instanceof ZodError) {
      // Validation error
      code = -32600; // Invalid Request (bad payload)
      message = "Request payload validation error";
      errorData = err.errors; // Include validation issues
    } else if (err instanceof Error) {
      // Use the error message from thrown Errors
      message = err.message;
      // Include error details in data if available
      // errorData = err.stack; // Be cautious logging stack traces externally
      errorData = err.message; // Simpler error data
    } else {
      // Catch other unexpected errors
      message = String(err);
    }

    // Return a JSON-RPC error response
    return createJsonRpcError(requestId ?? null, code, message, errorData);
  }
}

/**
 * Handles tasks/send requests (non-streaming).
 * @param req The validated SendTaskRequest.
 * @param context The A2AServerContext.
 * @param persistence The persistence layer.
 * @returns Promise resolving with the SendTaskResponse.
 * @throws Error if initialization or flow execution fails (handled by handleA2ARequest).
 */
async function handleSendTask(
  req: SendTaskRequest,
  context: A2AServerContext,
  persistence: Persistence,
): Promise<SendTaskResponse> {
  const { id: taskId, message, metadata } = req.params;
  let executionState: TaskExecutionState | null = null; // State variable for error handling

  try {
    // Initialize or load the task execution state
    executionState = initializeOrLoadTaskState(
      taskId,
      message,
      metadata,
      context,
      persistence,
    );

    // Run the flow, persist state, and collect results including artifacts (errors are re-thrown by runFlowAndPersist)
    const { finalHistory, finalAgentMsg, collectedArtifacts } =
      await runFlowAndPersist(
        taskId,
        executionState,
        persistence,
        undefined, // No SSE emitter for non-streaming
      );

    // Construct the final Task result object, including collected artifacts
    const taskResult = createTaskResponse(
      taskId,
      "completed", // State is 'completed' if runFlowAndPersist did not throw
      finalAgentMsg,
      finalHistory,
      collectedArtifacts, // Pass collected artifacts
      metadata, // Include task-level metadata from the request
    );

    // Return the successful JSON-RPC response
    return {
      jsonrpc: "2.0",
      id: req.id, // Use the request ID
      result: taskResult,
    };
  } catch (error) {
    // This catch block handles errors re-thrown by initializeOrLoadTaskState or runFlowAndPersist.
    // We re-throw them to the main handleA2ARequest catch block for centralized error response formatting.
    throw error;
  }
}

/**
 * Handles tasks/get requests.
 * @param req The validated GetTaskRequest.
 * @param context The A2AServerContext.
 * @param persistence The persistence layer.
 * @returns Promise resolving with the GetTaskResponse.
 * @throws Error if the task is not found or persistence fails (handled by handleA2ARequest).
 */
async function handleGetTask(
  req: GetTaskRequest,
  context: A2AServerContext,
  persistence: Persistence,
): Promise<GetTaskResponse> {
  const { id: taskId, historyLength } = req.params;
  const runId = persistence.getRunIdForA2ATask(taskId);

  // Check if task exists
  if (!runId) {
    // Task not found error is handled explicitly here
    return createJsonRpcError(
      req.id ?? null,
      -32001, // Task not found code
      `Task '${taskId}' not found`,
    );
  }

  // Retrieve run info and steps
  const runInfo = persistence.getRun(runId);
  if (!runInfo) {
    // Should not happen if getRunIdForA2ATask returns a runId, but defensive
    // Re-throw as internal error to be caught by handleA2ARequest
    throw new Error(
      `Internal error: Run ID ${runId} found for task '${taskId}' but run record is missing.`,
    );
  }

  const steps = persistence.getStepsForRun(runId);
  if (steps.length === 0) {
    // Task exists but has no steps - maybe initialized but failed immediately or is pending?
    // Report status based on runInfo status.
    const taskState: TaskState = (runInfo.status as TaskState) || "unknown"; // Use run status or unknown
    // Return a minimal Task object in the result
    const taskResult: Task = createTaskResponse(
      taskId,
      taskState,
      null, // No message if no steps
      [], // No history if no steps
      [], // No artifacts if no steps
      { skillId: runInfo.flow_name }, // Include skillId from runInfo if possible
    );
    return { jsonrpc: "2.0", id: req.id, result: taskResult };
  }

  const lastStep = steps[steps.length - 1]; // The last step record contains the final state
  const shared = JSON.parse(lastStep.shared_state_json) as SharedState; // Load final shared state
  const history: Message[] = (shared.__a2a_history as Message[]) || []; // Get history from shared state

  // Determine task state based on run status (completed, failed, active)
  let taskState: TaskState = (runInfo.status as TaskState) || "unknown";
  // You might refine this based on the last step's node/action if your flow uses specific states
  // e.g., if (runInfo.status === 'active' && lastStep.action === 'awaiting_input') taskState = 'input-required';

  // The final agent message is typically the last message in the history list with role 'agent'
  // Or potentially the message associated with the final state in shared state if the node set it
  const lastAgentMsg = [...history].reverse().find((m) => m.role === "agent");

  // Limit history length if requested
  const finalHistory =
    historyLength !== null && historyLength !== undefined && historyLength >= 0
      ? history.slice(historyLength * -1) // Get the last historyLength messages
      : history; // Return full history if no limit or negative limit

  // TODO: Implement loading artifacts from persistence for tasks/get if they are persisted.
  // Currently, artifacts are only collected during the run and returned in tasks/send/sendSubscribe.
  const persistedArtifacts: Artifact[] = []; // Placeholder for loading artifacts

  // Construct the Task object for the result
  const taskResult: Task = createTaskResponse(
    taskId,
    taskState, // Use the determined state
    lastAgentMsg || null, // Include the last agent message
    finalHistory, // Include the (potentially truncated) history
    persistedArtifacts, // Include any loaded artifacts (empty for now)
    { skillId: runInfo.flow_name }, // Include skillId from runInfo
  );

  return {
    jsonrpc: "2.0",
    id: req.id,
    result: taskResult,
  };
}

/**
 * Handles tasks/sendSubscribe requests (streaming via Server-Sent Events).
 * @param req The validated SendTaskStreamingRequest.
 * @param context The A2AServerContext.
 * @param res The Express response object for SSE streaming.
 * @param persistence The persistence layer.
 * @returns Promise that resolves when the stream is closed. Response is sent via res.write().
 * @throws Error if initialization fails (handled by handleA2ARequest).
 */
async function handleSendSubscribe(
  req: SendTaskStreamingRequest,
  context: A2AServerContext,
  res: SSEExpressResponse,
  persistence: Persistence,
): Promise<void> {
  // This handler does not return a JSONRPCResponse
  // --- SSE Setup ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache"); // Important for SSE
  res.setHeader("Connection", "keep-alive");
  // res.setHeader('X-Accel-Buffering', 'no'); // Often needed with proxies like Nginx
  res.flushHeaders?.(); // Ensure headers are sent immediately

  const { id: taskId, message, metadata } = req.params;
  let executionState: TaskExecutionState | null = null; // State variable for error handling

  // Function to send SSE events
  const sendSSEEvent = (
    event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
  ) => {
    try {
      // SSE format: 'data: <json_payload>\n\n'
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.(); // Ensure event is flushed immediately
      logger.debug(
        `[A2A Server] Sent SSE event for task ${taskId}: Type=${"status" in event ? "status" : "artifact"}`,
      );
    } catch (e) {
      // If writing fails, the connection is likely broken. End the stream.
      logger.error(
        `[A2A Server] Failed to write SSE event for task ${taskId}. Closing stream.`,
        e,
      );
      // Use a timeout to avoid potential multiple res.end() calls if flush also fails
      // Check if res is already ended before attempting to end again
      if (!res.writableEnded) {
        setTimeout(() => {
          if (!res.writableEnded) {
            // Check again inside timeout
            try {
              res.end();
            } catch (err) {
              logger.error(
                `[A2A Server] Error ending stream for ${taskId} in timeout`,
                err,
              );
            }
          }
        }, 100); // Small delay before attempting to end
      } else {
        logger.debug(
          `[A2A Server] SSE stream for task ${taskId} was already ended before error.`,
        );
      }
    }
  };

  try {
    // Initialize or load task state
    executionState = initializeOrLoadTaskState(
      taskId,
      message,
      metadata,
      context,
      persistence,
    );

    // Emit initial "submitted" or "working" event immediately after initialization/load
    sendSSEEvent({
      id: taskId, // A2A task ID
      status: {
        state: executionState.isNewTask ? "submitted" : "working", // State is 'submitted' for new tasks, 'working' for resumed
        message: executionState.initialMessage, // Echo back the initiating message
        timestamp: new Date().toISOString(),
      },
      final: false, // This is an initial/intermediate status update
      metadata: { skillId: executionState.skillId },
    });

    // Run the flow, passing the SSE emitter function.
    // runFlowAndPersist will call sseEmitter for status and artifact updates.
    // It handles persistence and re-throws errors.
    // We don't need the returned artifacts here, as they were emitted directly via SSE via the hook.
    const { finalAgentMsg } = await runFlowAndPersist(
      taskId,
      executionState,
      persistence,
      sendSSEEvent, // Pass the emitter function to the flow orchestrator
    );

    // If runFlowAndPersist completes without throwing, the task is successful.
    // Emit the final "completed" event.
    // The final message is composed *inside* runFlowAndPersist and stored in shared.__a2a_history
    // Let's retrieve it from the final shared state for the final event.
    const lastStepRecord = persistence.getLastStep(executionState.runId); // Get the final step record
    // Use the shared state from the last step, or the in-memory state if persistence failed or no steps were saved after init
    const finalSharedState = lastStepRecord
      ? (JSON.parse(lastStepRecord.shared_state_json) as SharedState)
      : executionState.shared;
    const finalHistory =
      (finalSharedState.__a2a_history as Message[]) || executionState.history; // Get history from shared state
    // Find the last agent message in the final history
    const finalAgentMsgFromHistory = [...finalHistory]
      .reverse()
      .find((m) => m.role === "agent");

    sendSSEEvent({
      id: taskId, // A2A task ID
      status: {
        state: "completed", // Final state
        message: finalAgentMsgFromHistory || null, // Include the final message from the flow
        timestamp: new Date().toISOString(), // Use current timestamp for final event
      },
      final: true, // This is the final event for this task run
      metadata: { skillId: executionState.skillId },
    });
    logger.log(
      `[A2A Server] Task ${taskId} (Run ${executionState.runId}) completed successfully, final SSE event sent.`,
    );
  } catch (error) {
    // This catch block handles errors re-thrown by initializeOrLoadTaskState or runFlowAndPersist
    logger.error(
      `[A2A Server] Error handling tasks/sendSubscribe for task ${taskId}${executionState?.runId ? ` (Run ${executionState.runId})` : ""}:`,
      error instanceof Error ? error.stack : error,
    );

    // Emit a final "failed" event via SSE
    // Ensure we have basic info even if executionState wasn't fully initialized
    const skillId = executionState?.skillId || metadata?.skillId || "unknown";
    const runId = executionState?.runId || "unknown";

    // Create a final message describing the error
    const errorMessage: Message = {
      role: "agent", // Error message comes from the agent/system
      parts: [
        {
          type: "text",
          text:
            error instanceof Error
              ? error.message
              : "An unknown error occurred during flow execution.",
        },
        // Optionally include error details in a data part for more structured errors
        error && typeof error === "object"
          ? ({
              type: "data",
              data: { error: JSON.parse(JSON.stringify(error)) },
            } as DataPart)
          : undefined,
      ].filter(Boolean) as Part[], // Filter out undefined if error data part is not added
    };

    sendSSEEvent({
      id: taskId, // A2A task ID
      status: {
        state: "failed", // Final state is failed
        message: errorMessage, // Include the error message
        timestamp: new Date().toISOString(), // Timestamp of failure
      },
      final: true, // This is the final event
      metadata: { skillId, runId },
    });

    // If the run was initialized, update its status in persistence to 'failed'
    if (executionState?.runId) {
      persistence.updateRunStatus(executionState.runId, "failed");
      logger.log(
        `[A2A Server] Task ${taskId} (Run ${executionState.runId}) marked as failed in persistence.`,
      );
      // Save a step record indicating failure (optional, but helpful for debugging)
      // Need access to current step index if possible, or derive from last step in persistence
      const lastStepRecord = persistence.getLastStep(executionState.runId);
      // Ensure the step index is always incrementing and reflects the point of failure
      const nextStepIndex = lastStepRecord
        ? lastStepRecord.step_index + 1
        : ((executionState.flow as any)._currentStepIndex ?? 1); // Use last step index or flow's current step +1
      persistence.addStep(
        executionState.runId,
        "A2A_ERROR", // Special node name for error step
        "failed", // Action is 'failed'
        nextStepIndex,
        executionState.shared, // Save shared state at point of failure
      );
      logger.log(
        `[A2A Server] Persisted error state (step ${nextStepIndex}) for run ${executionState.runId} (Task ${taskId})`,
      );
    }
  } finally {
    // Always ensure the SSE stream is ended
    if (!res.writableEnded) {
      try {
        res.end();
      } catch (err) {
        logger.error(`[A2A Server] Error ending stream for ${taskId}`, err);
      } // Log error but continue
      logger.log(
        `[A2A Server] SSE stream ended for task ${taskId} in finally block.`,
      );
    } else {
      logger.debug(
        `[A2A Server] SSE stream for task ${taskId} was already ended.`,
      );
    }
  }
}

// TODO: Implement tasks/cancel handler (needs persistence update, stopping running flow if possible)
// TODO: Implement tasks/pushNotification/set handler (needs storing push configs and making outbound requests when status/artifacts change)
// TODO: Implement tasks/pushNotification/get handler (needs retrieving stored push configs)
// TODO: Implement tasks/resubscribe handler (needs retrieving historical events or state and re-attaching SSE)
