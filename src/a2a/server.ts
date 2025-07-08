// import {
//   SendTaskRequest,
//   SendTaskResponse,
//   SendTaskStreamingRequest,
//   AgentCard,
//   Message,
//   Task,
//   TaskState,
//   TaskStatusUpdateEvent,
//   TaskArtifactUpdateEvent,
//   JSONRPCError,
//   GetTaskRequest,
//   GetTaskResponse,
//   isTextPart,
//   isDataPart,
//   Part,
//   Artifact, // Import Artifact type
// } from "./types";
// import type { Flow, SharedState, Params } from "../index";
// import type { Persistence, StepRecord } from "../utils/persistence";
// import { sqlitePersistence } from "../utils/persistence";
// import {
//   SendTaskRequestSchema,
//   SendTaskStreamingRequestSchema,
//   GetTaskRequestSchema,
// } from "./validation";
// import { logger } from "../utils/logger";
// import { v4 as uuidv4 } from "uuid";
// import type { Request, Response } from "express";
// import { ZodError } from "zod";

// // --- Interfaces ---

// export interface A2AServerContext {
//   flows: Record<string, Flow<any, any, any, any>>;
//   agentCard: AgentCard;
//   persistence?: Persistence; // DI for persistence
// }

// interface TaskExecutionState {
//   runId: number;
//   shared: SharedState; // The shared state object, modified in place by the flow
//   history: Message[];
//   flow: Flow<any, any, any, any>;
//   isNewTask: boolean;
//   initialMessage: Message; // The specific message that started *this* task run
//   skillId: string;
// }

// // --- Type Alias for SSE Response ---
// type SSEExpressResponse = Response & { flush?: () => void };

// // --- Main Request Handler ---

// /**
//  * Handle A2A JSON-RPC requests.
//  * If streaming, pass Express req/res for SSE.
//  */
// export async function handleA2ARequest(
//   req: any,
//   context: A2AServerContext,
//   expressReq?: Request, // Optional: Express request object (for context/streaming)
//   expressRes?: Response, // Optional: Express response object (for streaming)
// ): Promise<any> {
//   // Return type is any because it might return JSONRPCResponse or undefined (for streaming)
//   const persistence: Persistence = context.persistence || sqlitePersistence;
//   const requestId = req?.id ?? null; // Get the JSON-RPC request ID

//   try {
//     // Basic check for jsonrpc version
//     if (req.jsonrpc !== "2.0") {
//       return createJsonRpcError(
//         requestId,
//         -32600,
//         "Invalid Request",
//         "jsonrpc must be '2.0'",
//       );
//     }

//     switch (req.method) {
//       case "tasks/send":
//         // Validate incoming request structure
//         const sendReq = SendTaskRequestSchema.parse(req);
//         return await handleSendTask(sendReq, context, persistence);

//       case "tasks/get":
//         // Validate incoming request structure
//         const getReq = GetTaskRequestSchema.parse(req);
//         return await handleGetTask(getReq, context, persistence);

//       case "tasks/sendSubscribe":
//         // Validate incoming request structure
//         const streamReq = SendTaskStreamingRequestSchema.parse(req);
//         if (expressRes) {
//           // Streaming requires the Express response object
//           await handleSendSubscribe(
//             streamReq,
//             context,
//             expressRes,
//             persistence,
//           );
//           return; // Response handled via SSE stream, do not send a JSON response here
//         } else {
//           // Cannot perform streaming without the HTTP response object (e.g., if called from a non-HTTP context)
//           return createJsonRpcError(
//             requestId ?? null,
//             -32004, // Unsupported operation
//             "Streaming requires an HTTP response context",
//           );
//         }

//       // TODO: Add support for other A2A methods like tasks/cancel, tasks/pushNotification/set, etc.
//       default:
//         // Method not found
//         return createJsonRpcError(
//           requestId ?? null,
//           -32601,
//           "Method not found",
//         );
//     }
//   } catch (err) {
//     // Catch validation errors (ZodError) or internal errors
//     logger.error("[A2A] Request handling error:", {
//       requestId,
//       method: req?.method,
//       error: err instanceof Error ? err.stack : err,
//       requestBody: req, // Log the request body for debugging
//     });

//     // Determine JSON-RPC error code and message
//     let code = -32603; // Default to Internal error
//     let message = "Internal error";
//     let errorData: any = undefined;

//     if (err instanceof ZodError) {
//       // Invalid request payload or parameters
//       code = -32600; // Or -32602 for Invalid Params, but -32600 often covers schema issues
//       message = "Request payload validation error";
//       // Optionally include validation issues in errorData
//       errorData = err.errors;
//     } else if (err instanceof Error) {
//       // Use the error message from thrown Errors
//       message = err.message;
//       // Optionally include the error stack or specific data in errorData
//       // errorData = err.stack; // Be cautious logging stack traces externally
//     } else {
//       // Catch other unexpected errors
//       message = String(err);
//     }

//     // Return a JSON-RPC error response
//     return createJsonRpcError(requestId ?? null, code, message, errorData);
//   }
// }

// // --- Helper Functions ---

// /**
//  * Creates a standard JSON-RPC error response object.
//  */
// function createJsonRpcError(
//   id: string | number | null,
//   code: number,
//   message: string,
//   data?: any,
// ): { jsonrpc: "2.0"; id: any; error: JSONRPCError } {
//   return {
//     jsonrpc: "2.0",
//     id,
//     error: {
//       code,
//       message,
//       // Ensure data is serializable and does not expose sensitive info
//       data: data instanceof Error ? data.message : data, // Only include message for Errors
//     },
//   };
// }

// /**
//  * Finds the text content of the first TextPart in a message.
//  */
// function getFirstTextPart(message: Message): string | undefined {
//   const textPart = message.parts.find(isTextPart);
//   return textPart?.text;
// }

// /**
//  * Loads existing task state or initializes a new one for an A2A task.
//  * Populates the shared state with the incoming message and history.
//  * @param taskId The unique ID of the A2A task.
//  * @param message The incoming A2A Message for this specific request.
//  * @param metadata Optional metadata from the request params (used for skillId).
//  * @param context The A2AServerContext (flows, agentCard, persistence).
//  * @param persistence The persistence layer.
//  * @returns The initialized or loaded TaskExecutionState.
//  * @throws Error if the skill is not found or persistence fails.
//  */
// function _initializeOrLoadTaskState(
//   taskId: string,
//   message: Message, // The incoming message for *this* request
//   metadata: Record<string, unknown> | null | undefined,
//   context: A2AServerContext,
//   persistence: Persistence,
// ): TaskExecutionState {
//   // Determine the skill ID from metadata or default to the first skill
//   const skillIdRaw = metadata?.skillId || context.agentCard.skills[0]?.id;
//   const skillId =
//     typeof skillIdRaw === "string" && skillIdRaw
//       ? skillIdRaw
//       : String(skillIdRaw ?? "");

//   // Find the corresponding flow
//   const flow = context.flows[skillId];
//   if (!flow) {
//     throw new Error(`Skill '${skillId}' not found`);
//   }

//   let runId = persistence.getRunIdForA2ATask(taskId);
//   let shared: SharedState = {}; // Initialize shared state
//   let history: Message[] = [];
//   let isNewTask = false;

//   if (runId === undefined) {
//     // New task - create a new run
//     isNewTask = true;
//     runId = persistence.createRun(skillId); // Create a new run record
//     persistence.mapA2ATaskToRun(taskId, runId); // Link A2A task ID to run ID
//     history = [message]; // Start history with the initial message
//     logger.log(
//       `[A2A] Initialized new run ${runId} for task ${taskId} (Skill: ${skillId})`,
//     );
//   } else {
//     // Continuing task - load existing state
//     const lastStep = persistence.getLastStep(runId);
//     if (lastStep) {
//       // Load shared state and history from the last persisted step
//       shared = JSON.parse(lastStep.shared_state_json);
//       history = (shared.__a2a_history as Message[]) || [];
//     } else {
//       // This case indicates persistence inconsistency (run exists, but no steps)
//       logger.warn(
//         `[A2A] Run ${runId} found for task ${taskId} (Skill: ${skillId}), but no steps exist. Re-initializing state.`,
//       );
//       // Start with empty state and history
//       shared = {};
//       history = [];
//     }

//     // Append the *current incoming message* to the history if it's a new message
//     // Check against the last message in history to avoid duplicates on retries/resends
//     const lastMessageInHistory = history[history.length - 1];
//     // Simple check: is it a user message and are the parts identical?
//     if (
//       !lastMessageInHistory || // History is empty
//       lastMessageInHistory.role !== message.role || // Role is different
//       JSON.stringify(lastMessageInHistory.parts) !==
//         JSON.stringify(message.parts) // Parts are different
//     ) {
//       history.push(message); // Add the new message to history
//       logger.log(
//         `[A2A] Appended new message to history for task ${taskId} (Run ${runId})`,
//       );
//     } else {
//       logger.log(
//         `[A2A] Task ${taskId} (Run ${runId}) received duplicate message. Not appending to history.`,
//       );
//     }
//     logger.log(`[A2A] Loaded existing run ${runId} for task ${taskId}`);
//   }

//   // --- Populate shared state with A2A context expected by A2ABaseNode ---
//   // Always set the full message history on the shared state
//   shared.__a2a_history = history;
//   // Always set the *current incoming message* on the shared state.
//   // This is what A2ABaseNode.getIncomingMessage relies on for the *specific* message that triggered this run.
//   shared.__a2a_incoming_message = message; // <-- THIS LINE IS CRUCIAL FOR A2ABaseNode HELPERS

//   // Keep the first text part in shared.input for compatibility if needed by older nodes
//   shared.input = getFirstTextPart(message);

//   // Persist the initial state immediately for *new* runs.
//   // For continuing runs, the updated shared state (including history)
//   // is saved by the flow's orchestration logic at the end of each step.
//   if (isNewTask) {
//     // Using step index 0 for the initial state record
//     persistence.addStep(runId, "A2A_INIT", null, 0, shared);
//     logger.log(
//       `[A2A] Persisted initial state (step 0) for run ${runId} (Task ${taskId})`,
//     );
//   }
//   // For continuing tasks, the state is implicitly saved by Flow.orchestrate
//   // when it adds a step after a node finishes execution.

//   return {
//     runId,
//     shared, // Return the fully populated shared state object
//     history, // Return the updated history array
//     flow,
//     isNewTask,
//     initialMessage: message, // The message that initiated *this* task run
//     skillId,
//   };
// }

// /**
//  * Runs the PocketMesh flow, updates state, persists, and handles events.
//  * This function orchestrates the flow's lifecycle methods (prepare, execute, finalize)
//  * and manages state persistence and event emission (status, artifacts).
//  * @param taskId The unique ID of the A2A task.
//  * @param state The initialized or loaded TaskExecutionState.
//  * @param persistence The persistence layer.
//  * @param sseEmitter Optional function to emit SSE events for streaming (`tasks/sendSubscribe`).
//  * @returns Promise resolving with the final shared state, history, the final agent message, *and collected artifacts*.
//  * @throws Error if the flow execution fails.
//  */
// async function _runFlowAndPersist(
//   taskId: string,
//   state: TaskExecutionState,
//   persistence: Persistence,
//   sseEmitter?: (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => void,
// ): Promise<{
//   finalSharedState: SharedState;
//   finalHistory: Message[];
//   finalAgentMsg: Message; // The final message to be sent back in the Task response status
//   collectedArtifacts: Artifact[]; // <-- ADDED: Collected artifacts during this run
// }> {
//   const { runId, flow, shared, history, isNewTask, initialMessage, skillId } =
//     state;

//   const collectedArtifacts: Artifact[] = []; // <-- ADDED: Array to collect artifacts

//   // --- Setup Event Hooks (if streaming) ---
//   if (sseEmitter) {
//     // Hook into flow status updates and emit A2A TaskStatusUpdateEvent
//     flow.onStatusUpdate = (status) => {
//       // Map internal flow state messages to A2A message parts if needed
//       // For simplicity, let's just use a text part for the status message
//       const statusMessage: Message | null = status.message
//         ? {
//             role: "agent", // Status updates are from the agent
//             parts: [{ type: "text", text: status.message }],
//           }
//         : null;

//       // Map internal state string to A2A TaskState if necessary
//       let a2aState: TaskState = "working"; // Default A2A state is 'working' during execution
//       // Could map specific internal states like 'completed'/'failed' to different A2A states during the run if the flow emits them
//       // e.g., if (status.state === 'waiting_for_input') a2aState = 'input-required';
//       // Or if the flow signals completion/failure mid-run:
//       if (status.state === "completed") a2aState = "working"; // Intermediate node completion
//       if (status.state === "failed") a2aState = "working"; // Intermediate node failure (Flow will eventually re-throw)
//       // The final task state ('completed', 'failed') is determined *after* the flow runs.

//       // Emit the TaskStatusUpdateEvent via the provided emitter
//       sseEmitter({
//         id: taskId, // A2A task ID
//         status: {
//           state: a2aState,
//           message: statusMessage, // Message payload describing the status
//           timestamp: new Date().toISOString(), // Current timestamp
//         },
//         final: false, // Status updates are intermediate events, not final task state
//         // Optionally include metadata, e.g., current node, step index
//         metadata: {
//           node: status.node,
//           step: status.step, // Step index within the flow run (0-based)
//           totalSteps: status.totalSteps, // Total steps if available from the flow
//         },
//       });
//       logger.debug(
//         `[A2A] SSE Status Update for task ${taskId}: Node=${status.node}, State=${status.state}`,
//       );
//     };

//     // Hook into flow artifact emissions and emit A2A TaskArtifactUpdateEvent
//     flow.onArtifact = (artifact) => {
//       // Flow nodes are expected to emit artifacts in a format compatible with A2A Artifact type
//       // We should minimally ensure it has a 'parts' array.
//       if (artifact && Array.isArray(artifact.parts)) {
//         // *** ADDED: Collect artifact for non-streaming response ***
//         collectedArtifacts.push(artifact as Artifact); // Collect artifact

//         // Emit the TaskArtifactUpdateEvent via the provided emitter
//         sseEmitter({
//           id: taskId, // A2A task ID
//           artifact: artifact as any, // Cast to any, server handler will validate against Artifact schema
//           // Optionally include metadata
//           metadata: { skillId },
//         });
//         logger.debug(
//           `[A2A] SSE Artifact Update for task ${taskId}: Artifact=${artifact.name || "unnamed"}`,
//         );
//       } else {
//         logger.warn(
//           `[A2A] Flow emitted artifact in unexpected format for task ${taskId}:`,
//           artifact,
//         );
//       }
//     };

//     logger.log(`[A2A] SSE streaming enabled for task ${taskId}`);
//   } else {
//     // Ensure hooks are cleared for non-streaming runs to prevent unintended calls
//     flow.onStatusUpdate = undefined;
//     // *** ADDED: Still need to collect artifacts in non-streaming mode ***
//     // The flow.onArtifact hook is still called by nodes using this.flow?.onArtifact
//     // We need to keep the hook but just collect instead of emitting SSE.
//     flow.onArtifact = (artifact) => {
//       if (artifact && Array.isArray(artifact.parts)) {
//         collectedArtifacts.push(artifact as Artifact); // Collect artifact
//         logger.debug(
//           `[A2A] Collected artifact in non-streaming mode for task ${taskId}: Artifact=${artifact.name || "unnamed"}`,
//         );
//       } else {
//         logger.warn(
//           `[A2A] Flow emitted artifact in unexpected format (non-streaming) for task ${taskId}:`,
//           artifact,
//         );
//       }
//     };
//     logger.log(
//       `[A2A] Running task ${taskId} in non-streaming mode, collecting artifacts.`,
//     );
//   }

//   // --- Execute Flow Lifecycle ---
//   // The runLifecycle method orchestrates prepare, execute loop, and finalize.
//   // It modifies the 'shared' object in place.
//   // It will re-throw any unhandled errors from nodes.
//   try {
//     // Pass the shared state and params to the flow's runLifecycle
//     await flow.runLifecycle(shared, {}); // Pass empty params for now, flow nodes should use shared or defaultParams
//     logger.log(
//       `[A2A] Flow run ${runId} (Task ${taskId}) completed successfully.`,
//     );
//     // If successful, update the run status in persistence
//     persistence.updateRunStatus(runId, "completed");
//   } catch (flowError) {
//     // Catch any error re-thrown by runLifecycle (originating from any node step)
//     logger.error(
//       `[A2A] Flow run ${runId} (Task ${taskId}) failed during execution.`,
//       {
//         error: flowError instanceof Error ? flowError.stack : flowError,
//       },
//     );
//     // If failed, update the run status in persistence
//     persistence.updateRunStatus(runId, "failed");
//     // Re-throw the error to be caught by the top-level handleA2ARequest handler
//     throw flowError;
//   }

//   // --- Compose Final Agent Response Message (for tasks/send & final SSE for streaming) ---
//   // This message is included in the 'result.status.message' of the Task object
//   // returned by tasks/send, and as the message in the final SSE TaskStatusUpdateEvent.

//   const finalAgentMsg: Message = {
//     role: "agent", // The final message comes from the agent
//     parts: [], // Initialize with empty parts
//     // Optionally add metadata to the final message
//     // metadata: { skillId },
//   };

//   // *** FIX: Prioritize parts set by the node/flow in shared state ***
//   // Check if the flow/node explicitly set the final response parts using A2ABaseNode helpers
//   if (
//     shared.__a2a_final_response_parts &&
//     Array.isArray(shared.__a2a_final_response_parts)
//   ) {
//     // If explicit parts are set and are an array, use them
//     // Basic validation: ensure parts are valid A2A Part types?
//     // For now, trust the node/helper to put valid parts here.
//     finalAgentMsg.parts = shared.__a2a_final_response_parts as Part[];
//     logger.debug(
//       `[A2A] Using __a2a_final_response_parts for Task ${taskId} final message.`,
//     );
//   } else if (typeof shared.lastEcho === "string") {
//     // Fallback 1: If no explicit parts, but shared.lastEcho is a string, use it as a text part
//     finalAgentMsg.parts = [{ type: "text", text: shared.lastEcho }];
//     logger.debug(
//       `[A2A] Using shared.lastEcho for Task ${taskId} final message.`,
//     );
//   } else {
//     // Fallback 2: If no explicit parts and no lastEcho string, use a default completion message
//     finalAgentMsg.parts = [{ type: "text", text: "Flow completed." }];
//     logger.debug(`[A2A] Using default text for Task ${taskId} final message.`);
//   }

//   // --- Update History with the final agent message ---
//   // Get the history array from the final shared state
//   const finalHistory = (shared.__a2a_history as Message[]) || history; // Use updated history from shared state

//   // Only add the final agent message to history if it's different from the very last message
//   const lastMessageInHistory = finalHistory[finalHistory.length - 1];
//   if (
//     !lastMessageInHistory || // History is empty
//     lastMessageInHistory.role !== finalAgentMsg.role || // Role is different
//     JSON.stringify(lastMessageInHistory.parts) !==
//       JSON.stringify(finalAgentMsg.parts) // Parts are different
//   ) {
//     finalHistory.push(finalAgentMsg); // Add the new message to history
//     // Update the history in the shared state as well
//     shared.__a2a_history = finalHistory;
//     logger.debug(
//       `[A2A] Appended final agent message to history for task ${taskId}`,
//     );
//   } else {
//     logger.debug(
//       `[A2A] Task ${taskId} (Run ${runId}) produced duplicate final agent message. Not appending to history.`,
//     );
//   }

//   // --- Persist Final State ---
//   // Get the last step index recorded so far for this run
//   const lastStepRecord = persistence.getLastStep(runId);
//   const nextStepIndex = lastStepRecord ? lastStepRecord.step_index + 1 : 1; // Increment from last step or start at 1
//   // Save the final state (including the final history) as the last step
//   persistence.addStep(
//     runId,
//     "A2A_FINAL", // Use a special node name for the final state step
//     "completed", // Use action "completed" for successful runs
//     nextStepIndex,
//     shared, // Persist the final shared state object
//   );
//   logger.log(
//     `[A2A] Persisted final state (step ${nextStepIndex}) for run ${runId} (Task ${taskId})`,
//   );

//   // --- Return Results ---
//   // This returned object is used by handleSendTask to build the JSON-RPC result.
//   // For streaming, the final status event is emitted below the try/catch.
//   return {
//     finalSharedState: shared,
//     finalHistory,
//     finalAgentMsg,
//     collectedArtifacts,
//   }; // <-- ADDED collectedArtifacts to return
// }

// /**
//  * Constructs the final A2A Task object for a tasks/send response.
//  * @param taskId The task ID.
//  * @param state The final TaskState ('completed', 'failed', etc.).
//  * @param finalAgentMsg The final message from the agent.
//  * @param finalHistory The complete task history.
//  * @param artifacts The list of artifacts collected during the run. // <-- ADDED artifacts parameter
//  * @returns The A2A Task object.
//  */
// function _createA2ATaskResponse(
//   taskId: string,
//   state: TaskState,
//   finalAgentMsg: Message | null, // Allow null for failed tasks if no message could be composed
//   finalHistory: Message[],
//   artifacts: Artifact[], // <-- ADDED artifacts parameter
// ): Task {
//   const taskStatus: TaskStatus = {
//     state,
//     message: finalAgentMsg, // Include the final agent message here
//     timestamp: new Date().toISOString(), // Use current time for the final status
//   };

//   return {
//     id: taskId, // A2A task ID
//     status: taskStatus,
//     artifacts: artifacts, // <-- ADDED: Populate artifacts from the collected list
//     history: finalHistory, // Include the full message history
//     metadata: {}, // Optional metadata
//   };
// }

// // --- Method Handlers ---

// /**
//  * Handle tasks/send: Start or continue a PocketFlow run for the requested skill (non-streaming).
//  * @param req The validated SendTaskRequest JSON-RPC object.
//  * @param context The A2AServerContext.
//  * @param persistence The persistence layer.
//  * @returns Promise resolving with the SendTaskResponse JSON-RPC object.
//  * @throws Error if initialization or flow execution fails.
//  */
// async function handleSendTask(
//   req: SendTaskRequest,
//   context: A2AServerContext,
//   persistence: Persistence,
// ): Promise<SendTaskResponse> {
//   const { id: taskId, message, metadata } = req.params;

//   try {
//     // Initialize or load the task execution state
//     const executionState = _initializeOrLoadTaskState(
//       taskId,
//       message,
//       metadata,
//       context,
//       persistence,
//     );

//     // Run the flow, persist state, and collect results including artifacts (errors are re-thrown)
//     const { finalHistory, finalAgentMsg, collectedArtifacts } =
//       await _runFlowAndPersist(
//         // <-- ADDED collectedArtifacts
//         taskId,
//         executionState,
//         persistence,
//         undefined, // No SSE emitter for non-streaming
//       );

//     // Construct the final Task result object, including collected artifacts
//     const taskResult = _createA2ATaskResponse(
//       taskId,
//       "completed", // Assuming _runFlowAndPersist throws on failure, state is 'completed' here
//       finalAgentMsg,
//       finalHistory,
//       collectedArtifacts, // <-- Pass collected artifacts
//     );

//     // Return the successful JSON-RPC response
//     return {
//       jsonrpc: "2.0",
//       id: req.id, // Use the request ID
//       result: taskResult,
//     };
//   } catch (error) {
//     // This catch block handles errors re-thrown by _runFlowAndPersist or _initializeOrLoadTaskState
//     logger.error(
//       `[A2A] Error processing tasks/send for task ${taskId}:`,
//       error,
//     );
//     // Return a JSON-RPC error response
//     // When a flow fails, we may not have a final agent message or history,
//     // but we can still construct a Task object representing the failed state.
//     // Let's try to create a minimal failed Task response here.
//     // We should attempt to load history if the run was created, though it might be incomplete.

//     // Attempt to load history/run status if the run was initialized
//     let history: Message[] = [];
//     let runStatus: TaskState = "failed"; // Default to failed state
//     const runId =
//       executionState?.runId ?? persistence.getRunIdForA2ATask(taskId);

//     if (runId) {
//       try {
//         const runInfo = persistence.getRun(runId);
//         runStatus = (runInfo?.status as TaskState) || "failed";
//         const lastStep = persistence.getLastStep(runId);
//         if (lastStep) {
//           const shared = JSON.parse(lastStep.shared_state_json) as SharedState;
//           history = (shared.__a2a_history as Message[]) || [];
//         } else {
//           // If no steps but run exists, maybe history wasn't populated
//           history = executionState?.history || []; // Use execution state history if available
//         }
//       } catch (persistErr) {
//         logger.warn(
//           `[A2A] Failed to load history for failed task ${taskId} (run ${runId}):`,
//           persistErr,
//         );
//         history = executionState?.history || []; // Fallback
//       }
//     } else {
//       // If runId was never even initialized, use the initial message for history
//       history =
//         executionState?.history ||
//         (req.params.message ? [req.params.message] : []);
//     }

//     // Create a final message describing the error
//     const errorMessage: Message = {
//       role: "agent",
//       parts: [
//         {
//           type: "text",
//           text:
//             error instanceof Error
//               ? error.message
//               : "An unknown error occurred.",
//         },
//         // Optionally include error details in a data part
//         error && typeof error === "object"
//           ? ({
//               type: "data",
//               data: { error: JSON.parse(JSON.stringify(error)) },
//             } as DataPart)
//           : undefined,
//       ].filter(Boolean) as Part[],
//     };

//     // Construct the failed Task object
//     const failedTaskResult = _createA2ATaskResponse(
//       taskId,
//       runStatus, // Use run status (should be 'failed')
//       errorMessage, // The error message
//       history, // Include available history
//       [], // No collected artifacts on failure for now (could change this)
//     );

//     return {
//       jsonrpc: "2.0",
//       id: req.id,
//       result: failedTaskResult, // Return the Task object with failed status
//       // OR return a direct JSON-RPC error response:
//       // return createJsonRpcError(
//       //     req.id ?? null,
//       //     -32000, // Generic server error
//       //     error instanceof Error ? error.message : "Flow execution failed",
//       //     error,
//       // );
//       // Let's return a Task object with 'failed' status as it's more informative about the task state.
//     };
//   }
// }

// /**
//  * Handle tasks/get: Retrieve task status/history.
//  * @param req The validated GetTaskRequest JSON-RPC object.
//  * @param context The A2AServerContext.
//  * @param persistence The persistence layer.
//  * @returns Promise resolving with the GetTaskResponse JSON-RPC object.
//  * @throws Error if the task is not found or persistence fails.
//  */
// async function handleGetTask(
//   req: GetTaskRequest,
//   context: A2AServerContext,
//   persistence: Persistence,
// ): Promise<GetTaskResponse> {
//   const { id: taskId, historyLength } = req.params;
//   const runId = persistence.getRunIdForA2ATask(taskId);

//   // Check if task exists
//   if (!runId) {
//     return createJsonRpcError(
//       req.id ?? null,
//       -32001,
//       `Task '${taskId}' not found`,
//     );
//   }

//   // Retrieve run info and steps
//   const runInfo = persistence.getRun(runId);
//   if (!runInfo) {
//     // Should not happen if getRunIdForA2ATask returns a runId, but defensive
//     return createJsonRpcError(
//       req.id ?? null,
//       -32001,
//       `Internal error: Run ID ${runId} found for task '${taskId}' but run record is missing.`,
//     );
//   }

//   const steps = persistence.getStepsForRun(runId);
//   if (steps.length === 0) {
//     // Task exists but has no steps - maybe initialized but failed immediately?
//     // Report status based on runInfo if possible, or default.
//     const taskState: TaskState = (runInfo.status as TaskState) || "unknown"; // Use run status or unknown
//     // Return a minimal Task object
//     const taskResult: Task = {
//       id: taskId,
//       status: {
//         state: taskState,
//         message: null,
//         timestamp: runInfo.created_at,
//       },
//       artifacts: [], // No artifacts available if no steps
//       history: [],
//       metadata: {},
//     };
//     return { jsonrpc: "2.0", id: req.id, result: taskResult };
//   }

//   const lastStep = steps[steps.length - 1]; // The last step record contains the final state
//   const shared = JSON.parse(lastStep.shared_state_json) as SharedState; // Load final shared state
//   const history: Message[] = (shared.__a2a_history as Message[]) || []; // Get history from shared state

//   // Determine task state based on run status (completed, failed) or last step action (e.g., 'input-required' if added)
//   // Rely on run status primarily.
//   let taskState: TaskState = (runInfo.status as TaskState) || "unknown";
//   // If run status is active but last step action was 'input-required', reflect that?
//   // This requires flows to set a specific action like 'input-required'
//   // if (runInfo.status === 'active' && lastStep.action === 'input-required') {
//   //     taskState = 'input-required';
//   // }

//   // The final agent message is the last message in the history list with role 'agent'
//   // Or potentially the message in the last step's status field if the node explicitly set it?
//   // Let's stick to the last agent message in history for consistency with how _runFlowAndPersist populates history.
//   const lastAgentMsg = [...history].reverse().find((m) => m.role === "agent");

//   // Limit history length if requested
//   const finalHistory =
//     historyLength !== null && historyLength !== undefined && historyLength >= 0
//       ? history.slice(historyLength * -1) // Get the last historyLength messages
//       : history; // Return full history if no limit or negative limit

//   // TODO: Implement loading artifacts from persistence for tasks/get if they are persisted.
//   // Currently, artifacts are only collected during the run and returned in tasks/send.
//   const persistedArtifacts: Artifact[] = []; // Placeholder for loading artifacts

//   const taskResult: Task = {
//     id: taskId,
//     status: {
//       state: taskState,
//       message: lastAgentMsg || null, // Include the last agent message as the status message
//       timestamp: lastStep.created_at, // Timestamp of the last update
//     },
//     artifacts: persistedArtifacts, // Include any loaded artifacts (empty for now)
//     history: finalHistory, // Return the (potentially truncated) history
//     metadata: {}, // Optional metadata
//   };

//   return {
//     jsonrpc: "2.0",
//     id: req.id,
//     result: taskResult,
//   };
// }

// /**
//  * Handle tasks/sendSubscribe: Streaming via Server-Sent Events (SSE).
//  * @param req The validated SendTaskStreamingRequest JSON-RPC object.
//  * @param context The A2AServerContext.
//  * @param res The Express response object for SSE streaming.
//  * @param persistence The persistence layer.
//  * @returns Promise that resolves when the stream is closed. Response is sent via res.write().
//  */
// async function handleSendSubscribe(
//   req: SendTaskStreamingRequest,
//   context: A2AServerContext,
//   res: SSEExpressResponse,
//   persistence: Persistence,
// ) {
//   // --- SSE Setup ---
//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache"); // Important for SSE
//   res.setHeader("Connection", "keep-alive");
//   // res.setHeader('X-Accel-Buffering', 'no'); // Often needed with proxies like Nginx
//   res.flushHeaders?.(); // Ensure headers are sent immediately

//   const { id: taskId, message, metadata } = req.params;
//   let executionState: TaskExecutionState | null = null; // State variable for error handling

//   // Function to send SSE events
//   const sendSSEEvent = (
//     event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
//   ) => {
//     try {
//       // SSE format: 'data: <json_payload>\n\n'
//       res.write(`data: ${JSON.stringify(event)}\n\n`);
//       res.flush?.(); // Ensure event is flushed immediately
//       logger.debug(
//         `[A2A] Sent SSE event for task ${taskId}: Type=${"status" in event ? "status" : "artifact"}`,
//       );
//     } catch (e) {
//       logger.error(
//         `[A2A] Failed to write SSE event for task ${taskId}. Closing stream.`,
//         e,
//       );
//       // If writing fails, the connection is likely broken. End the stream.
//       // Use a timeout to avoid potential multiple res.end() calls if flush also fails
//       setTimeout(() => {
//         if (!res.writableEnded) {
//           try {
//             res.end();
//           } catch (err) {
//             logger.error(`[A2A] Error ending stream for ${taskId}`, err);
//           }
//         }
//       }, 100); // Small delay before attempting to end
//     }
//   };

//   try {
//     // Initialize or load task state
//     executionState = _initializeOrLoadTaskState(
//       taskId,
//       message,
//       metadata,
//       context,
//       persistence,
//     );

//     // Emit initial "submitted" event immediately after initialization
//     // This confirms the server received the request and started processing/loading the task.
//     sendSSEEvent({
//       id: taskId, // A2A task ID
//       status: {
//         state: executionState.isNewTask ? "submitted" : "working", // State is 'submitted' for new tasks, 'working' for resumed
//         message: executionState.initialMessage, // Echo back the initiating message
//         timestamp: new Date().toISOString(),
//       },
//       final: false, // This is an initial/intermediate status update
//       metadata: { skillId: executionState.skillId },
//     });

//     // Run the flow, passing the SSE emitter function.
//     // _runFlowAndPersist will call sseEmitter for status and artifact updates.
//     // It handles persistence and re-throws errors.
//     // Note: We don't need the returned artifacts here, as they are emitted directly via SSE.
//     await _runFlowAndPersist(
//       taskId,
//       executionState,
//       persistence,
//       sendSSEEvent, // Pass the emitter function to the flow orchestrator
//     );

//     // If _runFlowAndPersist completes without throwing, the task is successful.
//     // Emit the final "completed" event.
//     // The final message is composed *inside* _runFlowAndPersist and stored in shared.__a2a_history
//     // Let's retrieve it from the final shared state for the final event.
//     const lastStepRecord = persistence.getLastStep(executionState.runId); // Get the final step
//     const finalSharedState = lastStepRecord
//       ? (JSON.parse(lastStepRecord.shared_state_json) as SharedState)
//       : executionState.shared; // Use persisted state or in-memory state
//     const finalHistory =
//       (finalSharedState.__a2a_history as Message[]) || executionState.history;
//     // Find the last agent message in the final history
//     const finalAgentMsg = [...finalHistory]
//       .reverse()
//       .find((m) => m.role === "agent");

//     sendSSEEvent({
//       id: taskId, // A2A task ID
//       status: {
//         state: "completed", // Final state
//         message: finalAgentMsg || null, // Include the final message from the flow
//         timestamp: new Date().toISOString(), // Use current timestamp for final event
//       },
//       final: true, // This is the final event for this task run
//       metadata: { skillId: executionState.skillId },
//     });
//     logger.log(
//       `[A2A] Task ${taskId} (Run ${executionState.runId}) completed successfully, final SSE event sent.`,
//     );
//   } catch (error) {
//     // This catch block handles errors re-thrown by _initializeOrLoadTaskState or _runFlowAndPersist
//     logger.error(
//       `[A2A] Error handling tasks/sendSubscribe for task ${taskId}${executionState?.runId ? ` (Run ${executionState.runId})` : ""}:`,
//       error instanceof Error ? error.stack : error,
//     );

//     // Emit a final "failed" event via SSE
//     // Ensure we have basic info even if executionState wasn't fully initialized
//     const skillId = executionState?.skillId || metadata?.skillId || "unknown";
//     const runId = executionState?.runId || "unknown";

//     // Create a final message describing the error
//     const errorMessage: Message = {
//       role: "agent", // Error message comes from the agent/system
//       parts: [
//         {
//           type: "text",
//           text:
//             error instanceof Error
//               ? error.message
//               : "An unknown error occurred during flow execution.",
//         },
//         // Optionally include error details in a data part for more structured errors
//         error && typeof error === "object"
//           ? ({
//               type: "data",
//               data: { error: JSON.parse(JSON.stringify(error)) },
//             } as DataPart)
//           : undefined,
//       ].filter(Boolean) as Part[],
//     };

//     sendSSEEvent({
//       id: taskId, // A2A task ID
//       status: {
//         state: "failed", // Final state is failed
//         message: errorMessage, // Include the error message
//         timestamp: new Date().toISOString(), // Timestamp of failure
//       },
//       final: true, // This is the final event
//       metadata: { skillId, runId },
//     });

//     // If the run was initialized, update its status in persistence to 'failed'
//     if (executionState?.runId) {
//       persistence.updateRunStatus(executionState.runId, "failed");
//       logger.log(
//         `[A2A] Task ${taskId} (Run ${executionState.runId}) marked as failed in persistence.`,
//       );
//       // Save a step record indicating failure (optional, but helpful for debugging)
//       // Need access to current step index if possible, or derive from last step in persistence
//       const lastStepRecord = persistence.getLastStep(executionState.runId);
//       const nextStepIndex = lastStepRecord ? lastStepRecord.step_index + 1 : 1;
//       persistence.addStep(
//         executionState.runId,
//         "A2A_ERROR", // Special node name for error step
//         "failed", // Action is 'failed'
//         nextStepIndex,
//         executionState.shared, // Save shared state at point of failure
//       );
//       logger.log(
//         `[A2A] Persisted error state (step ${nextStepIndex}) for run ${executionState.runId} (Task ${taskId})`,
//       );
//     }
//   } finally {
//     // Always ensure the SSE stream is ended
//     if (!res.writableEnded) {
//       try {
//         res.end();
//       } catch (err) {
//         logger.error(`[A2A] Error ending stream for ${taskId}`, err);
//         err;
//       } // Log error but continue
//       logger.log(`[A2A] SSE stream ended for task ${taskId} in finally block.`);
//     } else {
//       logger.debug(`[A2A] SSE stream for task ${taskId} was already ended.`);
//     }
//   }
// }

// // TODO: Implement tasks/cancel handler
// // TODO: Implement tasks/pushNotification/set handler (requires storing push configs and making outbound requests)
// // TODO: Implement tasks/pushNotification/get handler
