import {
  SendTaskRequest,
  SendTaskResponse,
  SendTaskStreamingRequest,
  AgentCard,
  Message,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  JSONRPCError,
  GetTaskRequest,
  GetTaskResponse,
  isTextPart,
  Part,
} from "./types";
import type { Flow, SharedState, Params } from "../index";
import type { Persistence, StepRecord } from "../utils/persistence";
import { sqlitePersistence } from "../utils/persistence";
import {
  SendTaskRequestSchema,
  SendTaskStreamingRequestSchema,
  GetTaskRequestSchema,
} from "./validation";
import { logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response } from "express";
import { ZodError } from "zod";

// --- Interfaces ---

export interface A2AServerContext {
  flows: Record<string, Flow<any, any, any, any>>;
  agentCard: AgentCard;
  persistence?: Persistence; // DI for persistence
}

interface TaskExecutionState {
  runId: number;
  shared: SharedState;
  history: Message[];
  flow: Flow<any, any, any, any>;
  isNewTask: boolean;
  initialMessage: Message;
  skillId: string;
}

// --- Type Alias for SSE Response ---
type SSEExpressResponse = Response & { flush?: () => void };

// --- Main Request Handler ---

/**
 * Handle A2A JSON-RPC requests.
 * If streaming, pass Express req/res for SSE.
 */
export async function handleA2ARequest(
  req: any,
  context: A2AServerContext,
  expressReq?: Request,
  expressRes?: Response,
): Promise<any> {
  const persistence: Persistence = context.persistence || sqlitePersistence;
  const requestId = req?.id ?? null;

  try {
    switch (req.method) {
      case "tasks/send":
        SendTaskRequestSchema.parse(req);
        return await handleSendTask(req, context, persistence);
      case "tasks/get":
        GetTaskRequestSchema.parse(req);
        return await handleGetTask(req, context, persistence);
      case "tasks/sendSubscribe":
        SendTaskStreamingRequestSchema.parse(req);
        if (expressRes) {
          await handleSendSubscribe(req, context, expressRes, persistence);
          return; // Response handled via SSE
        } else {
          return createJsonRpcError(
            requestId ?? null,
            -32603,
            "Streaming requires HTTP response object",
          );
        }
      // TODO: Add cancel, push notification, etc.
      default:
        return createJsonRpcError(
          requestId ?? null,
          -32601,
          "Method not found",
        );
    }
  } catch (err) {
    logger.error("[A2A] Validation or internal error:", {
      requestId,
      error: err instanceof Error ? err.stack : err,
      requestBody: req,
    });
    let code = -32603; // Internal error default
    let message = "Internal error";
    if (err instanceof ZodError) {
      code = -32602; // Invalid params
      message = "Invalid parameters";
    } else if (err instanceof Error) {
      message = err.message; // Use specific error message if available
    }
    return createJsonRpcError(requestId ?? null, code, message, err);
  }
}

// --- Helper Functions ---

function createJsonRpcError(
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
      data: data instanceof Error ? data.message : data,
    },
  };
}

function getFirstTextPart(message: Message): string | undefined {
  const textPart = message.parts.find(isTextPart);
  return textPart?.text;
}

/**
 * Loads existing task state or initializes a new one.
 */
function _initializeOrLoadTaskState(
  taskId: string,
  message: Message,
  metadata: Record<string, unknown> | null | undefined,
  context: A2AServerContext,
  persistence: Persistence,
): TaskExecutionState {
  const skillIdRaw = metadata?.skillId || context.agentCard.skills[0]?.id;
  const skillId =
    typeof skillIdRaw === "string" ? skillIdRaw : String(skillIdRaw ?? "");
  const flow = context.flows[skillId];

  if (!flow) {
    throw new Error(`Skill '${skillId}' not found`);
  }

  let runId = persistence.getRunIdForA2ATask(taskId);
  let shared: SharedState = {};
  let history: Message[] = [];
  let isNewTask = false;

  // Always set input from the latest message
  shared.input = getFirstTextPart(message);

  if (runId === undefined) {
    // New task
    isNewTask = true;
    runId = persistence.createRun(skillId);
    persistence.mapA2ATaskToRun(taskId, runId);
    history = [message]; // Start history with the initial message
    shared.__a2a_history = history;
    // Persist initial step for the new run
    persistence.addStep(runId, "A2A_INIT", "start", 0, shared);
    logger.log(`[A2A] Initialized new run ${runId} for task ${taskId}`);
  } else {
    // Continuing task
    const lastStep = persistence.getLastStep(runId);
    if (lastStep) {
      shared = JSON.parse(lastStep.shared_state_json);
      history = (shared.__a2a_history as Message[]) || [];
    } else {
      // Should not happen if runId exists, but handle defensively
      logger.warn(
        `[A2A] Run ${runId} found for task ${taskId}, but no steps exist. Re-initializing history.`,
      );
      history = [];
    }

    // Only append the new message if it's different from the last user message
    const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
    if (
      !lastUserMsg ||
      JSON.stringify(lastUserMsg.parts) !== JSON.stringify(message.parts)
    ) {
      history.push(message);
      shared.__a2a_history = history; // Update shared state immediately
    } else {
      logger.log(
        `[A2A] Task ${taskId} received duplicate user message. Not appending to history.`,
      );
    }
    // Always update shared.input regardless of history append
    shared.input = getFirstTextPart(message);
    logger.log(`[A2A] Loaded existing run ${runId} for task ${taskId}`);
  }

  return {
    runId,
    shared,
    history,
    flow,
    isNewTask,
    initialMessage: message,
    skillId,
  };
}

/**
 * Runs the PocketMesh flow, updates state, persists, and handles events.
 */
async function _runFlowAndPersist(
  taskId: string,
  state: TaskExecutionState,
  persistence: Persistence,
  sseEmitter?: (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => void,
): Promise<{
  finalSharedState: SharedState;
  finalHistory: Message[];
  finalAgentMsg: Message;
}> {
  const { runId, flow, shared, history, isNewTask, initialMessage } = state;

  // --- Setup Event Hooks (if streaming) ---
  if (sseEmitter) {
    flow.onStatusUpdate = (status) => {
      let a2aState: TaskState = "working";
      // Map internal states to A2A states if needed, otherwise pass through
      if (status.state === "completed") a2aState = "working"; // Intermediate completion

      sseEmitter({
        id: taskId,
        status: {
          state: a2aState,
          message: status.message
            ? { role: "agent", parts: [{ type: "text", text: status.message }] }
            : undefined,
          timestamp: new Date().toISOString(),
        },
        final: false, // Status updates are never final during execution
      });
    };

    flow.onArtifact = (artifact) => {
      sseEmitter({
        id: taskId,
        artifact,
      });
    };
  } else {
    // Ensure hooks are cleared for non-streaming runs
    flow.onStatusUpdate = undefined;
    flow.onArtifact = undefined;
  }

  // --- Execute Flow ---
  // The runLifecycle modifies the 'shared' object in place.
  try {
    await flow.runLifecycle(shared, {}); // Pass empty params for now, flow nodes use shared.input
    logger.log(
      `[A2A] Flow run ${runId} (Task ${taskId}) completed successfully.`,
    );
  } catch (flowError) {
    logger.error(`[A2A] Flow run ${runId} (Task ${taskId}) failed.`, {
      error: flowError,
    });
    // Re-throw to be caught by the top-level handler
    throw flowError;
  }

  // --- Compose Agent Response ---
  // Use a default response if the flow didn't set a specific output
  const agentOutputText =
    typeof shared.lastEcho === "string" ? shared.lastEcho : "Flow completed.";
  const agentMsg: Message = {
    role: "agent",
    parts: [{ type: "text", text: agentOutputText }],
  };

  // --- Update History ---
  const finalHistory = (shared.__a2a_history as Message[]) || history; // Use updated history from shared state
  // Only add agent message if it's different from the last message
  const lastMessage = finalHistory[finalHistory.length - 1];
  if (
    !lastMessage ||
    lastMessage.role !== "agent" ||
    JSON.stringify(lastMessage.parts) !== JSON.stringify(agentMsg.parts)
  ) {
    finalHistory.push(agentMsg);
    shared.__a2a_history = finalHistory; // Ensure shared state reflects the absolute final history
  } else {
    logger.log(
      `[A2A] Task ${taskId} produced duplicate agent message. Not appending to history.`,
    );
  }

  // --- Persist Final Step ---
  const lastStep = persistence.getLastStep(runId);
  const nextStepIndex = lastStep ? lastStep.step_index + 1 : 1; // Increment from last step or start at 1
  persistence.addStep(
    runId,
    "A2A_RESPONSE",
    "completed",
    nextStepIndex,
    shared, // Persist the final shared state
  );
  persistence.updateRunStatus(runId, "completed");
  logger.log(
    `[A2A] Persisted final step ${nextStepIndex} for run ${runId} (Task ${taskId})`,
  );

  return { finalSharedState: shared, finalHistory, finalAgentMsg: agentMsg };
}

/**
 * Constructs the final A2A Task object.
 */
function _createA2ATaskResponse(
  taskId: string,
  state: TaskState,
  agentMsg: Message,
  history: Message[],
  // TODO: Add artifact handling if needed for non-streaming response
): Task {
  return {
    id: taskId,
    status: {
      state,
      message: agentMsg,
      timestamp: new Date().toISOString(),
    },
    artifacts: [], // TODO: Populate if needed
    history,
    metadata: {},
  };
}

// --- Method Handlers ---

/**
 * Handle tasks/send: Start or continue a PocketFlow run for the requested skill (non-streaming).
 */
async function handleSendTask(
  req: SendTaskRequest,
  context: A2AServerContext,
  persistence: Persistence,
): Promise<SendTaskResponse> {
  const { id: taskId, message, metadata } = req.params;

  try {
    const initialState = _initializeOrLoadTaskState(
      taskId,
      message,
      metadata,
      context,
      persistence,
    );

    const { finalHistory, finalAgentMsg } = await _runFlowAndPersist(
      taskId,
      initialState,
      persistence,
    );

    const taskResult = _createA2ATaskResponse(
      taskId,
      "completed",
      finalAgentMsg,
      finalHistory,
    );

    return {
      jsonrpc: "2.0",
      id: req.id,
      result: taskResult,
    };
  } catch (error) {
    return createJsonRpcError(
      req.id ?? null,
      -32000, // Using a generic server error code for flow failures
      error instanceof Error ? error.message : "Flow execution failed",
      error,
    );
  }
}

/**
 * Handle tasks/get: Retrieve task status/history.
 */
async function handleGetTask(
  req: GetTaskRequest,
  context: A2AServerContext,
  persistence: Persistence,
): Promise<GetTaskResponse> {
  const { id: taskId } = req.params;
  const runId = persistence.getRunIdForA2ATask(taskId);

  if (!runId) {
    return createJsonRpcError(
      req.id ?? null,
      -32001,
      `Task '${taskId}' not found`,
    );
  }

  const lastStep = persistence.getLastStep(runId);
  if (!lastStep) {
    // Should not happen if runId exists, but handle defensively
    return createJsonRpcError(
      req.id ?? null,
      -32001,
      `Task '${taskId}' found (run ${runId}) but has no steps`,
    );
  }

  const runInfo = persistence.getRun(runId);
  const shared = JSON.parse(lastStep.shared_state_json);
  const history: Message[] = (shared.__a2a_history as Message[]) || [];
  // Attempt to find the last agent message in history for status
  const lastAgentMsg = [...history].reverse().find((m) => m.role === "agent");

  // Determine state based on run status and last agent message
  let taskState: TaskState =
    runInfo?.status === "completed" ? "completed" : "unknown";
  if (!lastAgentMsg && taskState === "completed") {
    // If completed but no agent message, something might be off, report working?
    // Or use a default message. For now, let's report completed but maybe log a warning.
    logger.warn(
      `[A2A] Task ${taskId} (run ${runId}) is completed but has no final agent message in history.`,
    );
  }

  const taskResult: Task = {
    id: taskId,
    status: {
      state: taskState,
      message: lastAgentMsg || null, // Use last agent message or null
      timestamp: lastStep.created_at,
    },
    artifacts: [], // TODO: Load artifacts if persisted
    history: history, // Return full history
    metadata: {},
  };

  return {
    jsonrpc: "2.0",
    id: req.id,
    result: taskResult,
  };
}

/**
 * Handle tasks/sendSubscribe: Streaming via Server-Sent Events (SSE).
 */
async function handleSendSubscribe(
  req: SendTaskStreamingRequest,
  context: A2AServerContext,
  res: SSEExpressResponse,
  persistence: Persistence,
) {
  // --- SSE Setup ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.(); // Ensure headers are sent immediately

  const { id: taskId, message, metadata } = req.params;

  const sendSSEEvent = (
    event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
  ) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.(); // Ensure event is flushed immediately
    } catch (e) {
      logger.error(`[A2A] Failed to write SSE event for task ${taskId}:`, e);
      // Clean up? Close connection?
      res.end();
    }
  };

  try {
    const initialState = _initializeOrLoadTaskState(
      taskId,
      message,
      metadata,
      context,
      persistence,
    );

    // Emit "submitted" event immediately after initialization
    sendSSEEvent({
      id: taskId,
      status: {
        state: "submitted",
        message: initialState.initialMessage, // Echo back the initiating message
        timestamp: new Date().toISOString(),
      },
      final: false,
    });

    // Run the flow, passing the SSE emitter
    const { finalAgentMsg } = await _runFlowAndPersist(
      taskId,
      initialState,
      persistence,
      sendSSEEvent, // Pass the emitter function
    );

    // Emit final "completed" event
    sendSSEEvent({
      id: taskId,
      status: {
        state: "completed",
        message: finalAgentMsg,
        timestamp: new Date().toISOString(),
      },
      final: true,
    });
  } catch (error) {
    logger.error(
      `[A2A] Error handling tasks/sendSubscribe for ${taskId}:`,
      error,
    );
    // Emit a final "failed" event
    sendSSEEvent({
      id: taskId,
      status: {
        state: "failed",
        message: {
          // Provide error message back to client
          role: "agent",
          parts: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "Flow execution failed",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
      final: true,
    });
    // Persist failure state?
    const runId = persistence.getRunIdForA2ATask(taskId);
    if (runId) {
      persistence.updateRunStatus(runId, "failed");
    }
  } finally {
    // End the SSE stream
    res.end();
    logger.log(`[A2A] SSE stream ended for task ${taskId}`);
  }
}
