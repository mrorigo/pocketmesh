import type {
  Message,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Artifact,
  Part,
} from "../types"; // Import A2A types
import type { SharedState } from "../../core/types"; // Import core types
import { logger } from "../../utils/logger"; // Use core logger
import type { Persistence } from "../../utils/persistence"; // Import persistence type
import type { A2AServerContext, TaskExecutionState } from "./types"; // Import server types
import { getFirstTextPart } from "./utils"; // Import server utilities (createTaskResponse is in utils)

/**
 * Loads existing task state or initializes a new one for an A2A task.
 * Populates the shared state with the incoming message and history.
 * This is the first step in processing a new A2A request (tasks/send, tasks/sendSubscribe, potentially others).
 * @param taskId The unique ID of the A2A task.
 * @param message The incoming A2A Message for this specific request.
 * @param metadata Optional metadata from the request params (used for skillId).
 * @param context The A2AServerContext (flows, agentCard, persistence).
 * @param persistence The persistence layer.
 * @returns The initialized or loaded TaskExecutionState.
 * @throws Error if the skill is not found or persistence fails.
 */
export function initializeOrLoadTaskState(
  taskId: string,
  message: Message, // The incoming message for *this* request
  metadata: Record<string, unknown> | null | undefined,
  context: A2AServerContext,
  persistence: Persistence,
): TaskExecutionState {
  // Determine the skill ID from metadata or default to the first skill
  const skillIdRaw = metadata?.skillId || context.agentCard.skills[0]?.id;
  const skillId =
    typeof skillIdRaw === "string" && skillIdRaw
      ? skillIdRaw
      : String(skillIdRaw ?? "");

  // Find the corresponding flow
  const flow = context.flows[skillId];
  if (!flow) {
    throw new Error(`Skill '${skillId}' not found`);
  }

  let runId = persistence.getRunIdForA2ATask(taskId);
  let shared: SharedState = {}; // Initialize shared state
  let history: Message[] = [];
  let isNewTask = false;

  if (runId === undefined) {
    // New task - create a new run
    isNewTask = true;
    runId = persistence.createRun(skillId); // Create a new run record
    persistence.mapA2ATaskToRun(taskId, runId); // Link A2A task ID to run ID
    history = [message]; // Start history with the initial message
    logger.log(
      `[A2A Server] Initialized new run ${runId} for task ${taskId} (Skill: ${skillId})`,
    );
  } else {
    // Continuing task - load existing state
    const lastStep = persistence.getLastStep(runId);
    if (lastStep) {
      // Load shared state and history from the last persisted step
      shared = JSON.parse(lastStep.shared_state_json);
      history = (shared.__a2a_history as Message[]) || [];
    } else {
      // This case indicates persistence inconsistency (run exists, but no steps)
      logger.warn(
        `[A2A Server] Run ${runId} found for task ${taskId} (Skill: ${skillId}), but no steps exist. Re-initializing state.`,
      );
      // Start with empty state and history
      shared = {};
      history = [];
    }

    // Append the *current incoming message* to the history if it's a new message
    // Check against the last message in history to avoid duplicates on retries/resends
    const lastMessageInHistory = history[history.length - 1];
    // Simple check: is it a user message and are the parts identical?
    if (
      !lastMessageInHistory || // History is empty
      lastMessageInHistory.role !== message.role || // Role is different
      JSON.stringify(lastMessageInHistory.parts) !==
        JSON.stringify(message.parts) // Parts are different
    ) {
      history.push(message); // Add the new message to history
      logger.log(
        `[A2A Server] Appended new message to history for task ${taskId} (Run ${runId})`,
      );
    } else {
      logger.log(
        `[A2A Server] Task ${taskId} (Run ${runId}) received duplicate message. Not appending to history.`,
      );
    }
    logger.log(`[A2A Server] Loaded existing run ${runId} for task ${taskId}`);
  }

  // --- Populate shared state with A2A context expected by A2ABaseNode ---
  // Always set the full message history on the shared state
  shared.__a2a_history = history;
  // Always set the *current incoming message* on the shared state.
  // This is what A2ABaseNode.getIncomingMessage relies on for the *specific* message that triggered this run.
  shared.__a2a_incoming_message = message; // <-- THIS LINE IS CRUCIAL FOR A2ABaseNode HELPERS

  // Keep the first text part in shared.input for compatibility if needed by older nodes
  shared.input = getFirstTextPart(message);

  // Persist the initial state immediately for *new* runs.
  // For continuing runs, the updated shared state (including history)
  // is saved by the flow's orchestration logic at the end of each step.
  if (isNewTask) {
    // Using step index 0 for the initial state record
    persistence.addStep(runId, "A2A_INIT", null, 0, shared);
    logger.log(
      `[A2A Server] Persisted initial state (step 0) for run ${runId} (Task ${taskId})`,
    );
  }
  // For continuing tasks, the state is implicitly saved by Flow.orchestrate
  // when it adds a step after a node finishes execution.

  return {
    runId,
    shared, // Return the fully populated shared state object
    history, // Return the updated history array
    flow,
    isNewTask,
    initialMessage: message, // The message that initiated *this* task run
    skillId,
  };
}

/**
 * Runs the PocketMesh flow, updates state, persists, and handles events.
 * This function orchestrates the flow's lifecycle methods (prepare, execute, finalize)
 * and manages state persistence and event emission (status, artifacts).
 * @param taskId The unique ID of the A2A task.
 * @param state The initialized or loaded TaskExecutionState.
 * @param persistence The persistence layer.
 * @param sseEmitter Optional function to emit SSE events for streaming (`tasks/sendSubscribe`).
 * @returns Promise resolving with the final shared state, history, the final agent message, and collected artifacts.
 * @throws Error if the flow execution fails.
 */
export async function runFlowAndPersist(
  taskId: string,
  state: TaskExecutionState,
  persistence: Persistence,
  sseEmitter?: (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => void,
): Promise<{
  finalSharedState: SharedState;
  finalHistory: Message[];
  finalAgentMsg: Message; // The final message to be sent back in the Task response status
  collectedArtifacts: Artifact[]; // Collected artifacts during this run
}> {
  const { runId, flow, shared, history, isNewTask, initialMessage, skillId } =
    state;

  const collectedArtifacts: Artifact[] = []; // Array to collect artifacts

  // --- Setup Event Hooks ---
  // These hooks are called by the flow's orchestration logic during runLifecycle
  flow.onStatusUpdate = (status) => {
    // Map internal flow state messages to A2A message parts if needed
    const statusMessage: Message | null = status.message
      ? {
          role: "agent", // Status updates are from the agent
          parts: [{ type: "text", text: status.message }],
        }
      : null;

    // Map internal state string to A2A TaskState if necessary
    let a2aState: TaskState = "working"; // Default A2A state is 'working' during execution
    // Could map specific internal states like 'completed'/'failed' to different A2A states during the run if the flow emits them
    // e.g., if (status.state === 'waiting_for_input') a2aState = 'input-required';
    // Or if the flow signals completion/failure mid-run:
    if (status.state === "completed") a2aState = "working"; // Intermediate node completion
    if (status.state === "failed") a2aState = "working"; // Intermediate node failure (Flow will eventually re-throw)
    // The final task state ('completed', 'failed') is determined *after* the flow runs.

    const event: TaskStatusUpdateEvent = {
      id: taskId, // A2A task ID
      status: {
        state: a2aState,
        message: statusMessage, // Message payload describing the status
        timestamp: new Date().toISOString(), // Current timestamp
      },
      final: false, // Status updates are intermediate events, not final task state
      metadata: {
        node: status.node,
        step: status.step, // Step index within the flow run (0-based)
        totalSteps: status.totalSteps, // Total steps if available from the flow
      },
    };

    // If SSE emitter is provided, send the event immediately
    if (sseEmitter) {
      sseEmitter(event);
      logger.debug(
        `[A2A Server] SSE Status Update for task ${taskId}: Node=${status.node}, State=${status.state}`,
      );
    } else {
      // In non-streaming mode, status updates are not emitted as events
      logger.debug(
        `[A2A Server] Non-streaming status update for task ${taskId}: Node=${status.node}, State=${status.state}`,
      );
    }
  };

  flow.onArtifact = (artifact) => {
    // Flow nodes are expected to emit artifacts in a format compatible with A2A Artifact type
    // We should minimally ensure it has a 'parts' array.
    if (artifact && Array.isArray(artifact.parts)) {
      const a2aArtifact: Artifact = artifact as Artifact; // Cast to Artifact for collection/emission

      // Always collect artifact for the final tasks/send response (if not streaming)
      // Or for the final Task object in case of streaming (though SSE is primary)
      collectedArtifacts.push(a2aArtifact); // Collect artifact
      logger.debug(
        `[A2A Server] Collected artifact for task ${taskId}: Artifact=${a2aArtifact.name || "unnamed"}`,
      );

      // If SSE emitter is provided, send the event immediately
      if (sseEmitter) {
        const event: TaskArtifactUpdateEvent = {
          id: taskId, // A2A task ID
          artifact: a2aArtifact, // Emitting the collected artifact
          // Optionally include metadata
          metadata: { skillId },
        };
        sseEmitter(event);
        logger.debug(
          `[A2A Server] SSE Artifact Update for task ${taskId}: Artifact=${a2aArtifact.name || "unnamed"}`,
        );
      }
    } else {
      logger.warn(
        `[A2A Server] Flow emitted artifact in unexpected format for task ${taskId}:`,
        artifact,
      );
    }
  };

  // --- Execute Flow Lifecycle ---
  // The runLifecycle method orchestrates prepare, execute loop, and finalize.
  // It modifies the 'shared' object in place.
  // It will re-throw any unhandled errors from nodes.
  try {
    // Pass the shared state and params to the flow's runLifecycle
    await flow.runLifecycle(shared, {}); // Pass empty params for now, flow nodes should use shared or defaultParams
    logger.log(
      `[A2A Server] Flow run ${runId} (Task ${taskId}) completed successfully.`,
    );
    // If successful, update the run status in persistence
    persistence.updateRunStatus(runId, "completed");
  } catch (flowError) {
    // Catch any error re-thrown by runLifecycle (originating from any node step)
    logger.error(
      `[A2A Server] Flow run ${runId} (Task ${taskId}) failed during execution.`,
      {
        error: flowError instanceof Error ? flowError.stack : flowError,
      },
    );
    // If failed, update the run status in persistence
    persistence.updateRunStatus(runId, "failed");
    // Re-throw the error to be caught by the top-level handleA2ARequest handler
    throw flowError;
  } finally {
    // Clear the hooks after the flow run is finished (success or failure)
    // Prevents hooks from potentially being called if the flow instance is reused
    // and the server logic doesn't explicitly clear them.
    flow.onStatusUpdate = undefined;
    flow.onArtifact = undefined;
  }

  // --- Compose Final Agent Response Message (for tasks/send & final SSE for streaming) ---
  // This message is included in the 'result.status.message' of the Task object
  // returned by tasks/send, and as the message in the final SSE TaskStatusUpdateEvent.

  const finalAgentMsg: Message = {
    role: "agent", // The final message comes from the agent
    parts: [], // Initialize with empty parts
    // Optionally add metadata to the final message
    // metadata: { skillId },
  };

  // Prioritize parts set by the node/flow in shared state (using A2ABaseNode helper)
  if (
    shared.__a2a_final_response_parts &&
    Array.isArray(shared.__a2a_final_response_parts)
  ) {
    // If explicit parts are set and are an array, use them
    // Basic validation: ensure parts are valid A2A Part types?
    // For now, trust the node/helper to put valid parts here.
    finalAgentMsg.parts = shared.__a2a_final_response_parts as Part[];
    logger.debug(
      `[A2A Server] Using __a2a_final_response_parts for Task ${taskId} final message.`,
    );
  } else if (typeof shared.lastEcho === "string") {
    // Fallback 1: If no explicit parts, but shared.lastEcho is a string, use it as a text part
    finalAgentMsg.parts = [{ type: "text", text: shared.lastEcho }];
    logger.debug(
      `[A2A Server] Using shared.lastEcho for Task ${taskId} final message.`,
    );
  } else {
    // Fallback 2: If no explicit parts and no lastEcho string, use a default completion message
    finalAgentMsg.parts = [{ type: "text", text: "Flow completed." }];
    logger.debug(
      `[A2A Server] Using default text for Task ${taskId} final message.`,
    );
  }

  // --- Update History with the final agent message ---
  // Get the history array from the final shared state
  const finalHistory = (shared.__a2a_history as Message[]) || history; // Use updated history from shared state

  // Only add the final agent message to history if it's different from the very last message
  const lastMessageInHistory = finalHistory[finalHistory.length - 1];
  if (
    !lastMessageInHistory || // History is empty
    lastMessageInHistory.role !== finalAgentMsg.role || // Role is different
    JSON.stringify(lastMessageInHistory.parts) !==
      JSON.stringify(finalAgentMsg.parts) // Parts are different
  ) {
    finalHistory.push(finalAgentMsg); // Add the new message to history
    // Update the history in the shared state as well
    shared.__a2a_history = finalHistory;
    logger.debug(
      `[A2A Server] Appended final agent message to history for task ${taskId}`,
    );
  } else {
    logger.debug(
      `[A2A Server] Task ${taskId} (Run ${runId}) produced duplicate final agent message. Not appending to history.`,
    );
  }

  // --- Persist Final State ---
  const lastStepRecord = persistence.getLastStep(runId);
  // *** FIX: Simplify nextStepIndex calculation ***
  // The next step index is simply the index of the last *persisted* step plus 1.
  // It doesn't need to account for the flow's internal step index.
  const nextStepIndex = lastStepRecord ? lastStepRecord.step_index + 1 : 1; // <-- SIMPLIFIED CALCULATION

  persistence.addStep(
    runId,
    "A2A_FINAL", // Use a special node name for the final state step
    "completed", // Use action "completed" for successful runs
    nextStepIndex, // Use the determined next step index
    shared, // Persist the final shared state object
  );
  logger.log(
    `[A2A Server] Persisted final state (step ${nextStepIndex}) for run ${runId} (Task ${taskId})`,
  );

  // --- Return Results ---
  // This returned object is used by handleSendTask to build the JSON-RPC result.
  // For streaming, the final status event is emitted separately.
  return {
    finalSharedState: shared,
    finalHistory,
    finalAgentMsg,
    collectedArtifacts,
  };
}

// Add other task management helpers here if needed
