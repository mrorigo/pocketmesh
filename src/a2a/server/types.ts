import type { AgentCard, Message } from "../types"; // Import A2A types from parent directory
import type { SharedState } from "../../core/types"; // Import core types
import type { Persistence } from "../../utils/persistence"; // Import persistence type
import type { Response } from "express"; // Import Express Response type
import { Flow } from "../../core";

/**
 * Context object passed to A2A server handler functions.
 * Contains necessary dependencies like flows, agent card, and persistence.
 */
export interface A2AServerContext {
  flows: Record<string, Flow<any, any, any, any>>; // Map of skillId to Flow instance
  agentCard: AgentCard; // The agent's self-description
  persistence?: Persistence; // Optional persistence layer instance
}

/**
 * Represents the internal state of an A2A task execution run.
 * Used by the task management logic.
 */
export interface TaskExecutionState {
  runId: number; // The internal persistence run ID linked to the A2A task ID
  shared: SharedState; // The shared state object for the flow run
  history: Message[]; // The message history for the task
  flow: Flow<any, any, any, any>; // The Flow instance being executed
  isNewTask: boolean; // Flag indicating if this is a new task run
  initialMessage: Message; // The specific message that initiated *this* request/run
  skillId: string; // The skill ID being executed
}

/**
 * Extended Express Response type for SSE streaming.
 */
export type SSEExpressResponse = Response & { flush?: () => void };
