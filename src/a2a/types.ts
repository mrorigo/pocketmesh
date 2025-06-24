/**
 * A2A Protocol TypeScript Types
 * Generated from the official JSON schema.
 * All types are exported for developer use.
 */

import { SharedState } from "../core";

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

// --- Agent Card Types ---

export interface AgentProvider {
  organization: string;
  url?: string | null;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  examples?: string[] | null;
  inputModes?: string[] | null;
  outputModes?: string[] | null;
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentAuthentication {
  schemes: string[];
  credentials?: string | null;
}

export interface AgentCard {
  name: string;
  description?: string | null;
  url: string;
  provider?: AgentProvider | null;
  version: string;
  documentationUrl?: string | null;
  capabilities: AgentCapabilities;
  authentication?: AgentAuthentication | null;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: AgentSkill[];
}

// --- Part/Message/Artifact Types ---

export interface TextPart {
  type: "text";
  text: string;
  metadata?: Record<string, unknown> | null;
}

export interface FileContent {
  name?: string | null;
  mimeType?: string | null;
  bytes?: string | null;
  uri?: string | null;
}

export interface FilePart {
  type: "file";
  file: FileContent;
  metadata?: Record<string, unknown> | null;
}

export interface DataPart {
  type: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export type Part = TextPart | FilePart | DataPart;

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, unknown> | null;
}

export interface Artifact {
  name?: string | null;
  description?: string | null;
  parts: Part[];
  index?: number;
  append?: boolean | null;
  lastChunk?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

// --- Task/Status Types ---

export interface TaskStatus {
  state: TaskState;
  message?: Message | null;
  timestamp?: string;
}

export interface Task {
  id: string;
  sessionId?: string | null;
  status: TaskStatus;
  artifacts?: Artifact[] | null;
  history?: Message[] | null;
  metadata?: Record<string, unknown> | null;
}

// --- Push Notification Types ---

export interface AuthenticationInfo {
  schemes: string[];
  credentials?: string | null;
  [key: string]: unknown;
}

export interface PushNotificationConfig {
  url: string;
  token?: string | null;
  authentication?: AuthenticationInfo | null;
}

export interface TaskPushNotificationConfig {
  id: string;
  pushNotificationConfig: PushNotificationConfig;
}

// --- JSON-RPC Types ---

export interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
}

export interface JSONRPCRequest extends JSONRPCMessage {
  method: string;
  params?: Record<string, unknown> | null;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown | null;
}

export interface JSONRPCResponse extends JSONRPCMessage {
  result?: unknown | null;
  error?: JSONRPCError | null;
}

// --- A2A Request/Response Types ---

export interface SendTaskRequest extends JSONRPCMessage {
  method: "tasks/send";
  params: TaskSendParams;
}

export interface SendTaskResponse extends JSONRPCMessage {
  result?: Task | null;
  error?: JSONRPCError | null;
}

export interface SendTaskStreamingRequest extends JSONRPCMessage {
  method: "tasks/sendSubscribe";
  params: TaskSendParams;
}

export interface SendTaskStreamingResponse extends JSONRPCMessage {
  result?: TaskStatusUpdateEvent | TaskArtifactUpdateEvent | null;
  error?: JSONRPCError | null;
}

export interface GetTaskRequest extends JSONRPCMessage {
  method: "tasks/get";
  params: TaskQueryParams;
}

export interface GetTaskResponse extends JSONRPCMessage {
  result?: Task | null;
  error?: JSONRPCError | null;
}

export interface CancelTaskRequest extends JSONRPCMessage {
  method: "tasks/cancel";
  params: TaskIdParams;
}

export interface CancelTaskResponse extends JSONRPCMessage {
  result?: Task | null;
  error?: JSONRPCError | null;
}

export interface SetTaskPushNotificationRequest extends JSONRPCMessage {
  method: "tasks/pushNotification/set";
  params: TaskPushNotificationConfig;
}

export interface SetTaskPushNotificationResponse extends JSONRPCMessage {
  result?: TaskPushNotificationConfig | null;
  error?: JSONRPCError | null;
}

export interface GetTaskPushNotificationRequest extends JSONRPCMessage {
  method: "tasks/pushNotification/get";
  params: TaskIdParams;
}

export interface GetTaskPushNotificationResponse extends JSONRPCMessage {
  result?: TaskPushNotificationConfig | null;
  error?: JSONRPCError | null;
}

export interface TaskResubscriptionRequest extends JSONRPCMessage {
  method: "tasks/resubscribe";
  params: TaskQueryParams;
}

// --- Params Types ---

export interface TaskIdParams {
  id: string;
  metadata?: Record<string, unknown> | null;
}

export interface TaskQueryParams {
  id: string;
  historyLength?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface TaskSendParams {
  id: string;
  sessionId?: string;
  message: Message;
  pushNotification?: PushNotificationConfig | null;
  historyLength?: number | null;
  metadata?: Record<string, unknown> | null;
}

// --- Streaming Event Types ---

export interface TaskStatusUpdateEvent {
  id: string;
  status: TaskStatus;
  final?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface TaskArtifactUpdateEvent {
  id: string;
  artifact: Artifact;
  metadata?: Record<string, unknown> | null;
}

// --- Error Types (specific codes) ---

export interface MethodNotFoundError extends JSONRPCError {
  code: -32601;
  message: "Method not found";
  data: null;
}

export interface InvalidRequestError extends JSONRPCError {
  code: -32600;
  message: "Request payload validation error";
}

export interface InvalidParamsError extends JSONRPCError {
  code: -32602;
  message: "Invalid parameters";
}

export interface InternalError extends JSONRPCError {
  code: -32603;
  message: "Internal error";
}

export interface JSONParseError extends JSONRPCError {
  code: -32700;
  message: "Invalid JSON payload";
}

export interface TaskNotFoundError extends JSONRPCError {
  code: -32001;
  message: "Task not found";
  data: null;
}

export interface TaskNotCancelableError extends JSONRPCError {
  code: -32002;
  message: "Task cannot be canceled";
  data: null;
}

export interface PushNotificationNotSupportedError extends JSONRPCError {
  code: -32003;
  message: "Push Notification is not supported";
  data: null;
}

export interface UnsupportedOperationError extends JSONRPCError {
  code: -32004;
  message: "This operation is not supported";
  data: null;
}

// --- Union for all A2A requests (for type guards) ---

export type A2ARequest =
  | SendTaskRequest
  | SendTaskStreamingRequest
  | GetTaskRequest
  | CancelTaskRequest
  | SetTaskPushNotificationRequest
  | GetTaskPushNotificationRequest
  | TaskResubscriptionRequest;

// --- Union for all A2A responses (for type guards) ---

export type A2AResponse =
  | SendTaskResponse
  | SendTaskStreamingResponse
  | GetTaskResponse
  | CancelTaskResponse
  | SetTaskPushNotificationResponse
  | GetTaskPushNotificationResponse;

/**
 * SharedState augmented with A2A-specific properties populated by the server handler.
 * Nodes operating in an A2A context can expect these properties to be present.
 * Your custom shared state interface should extend this if using A2ABaseNode.
 */
export interface A2ASharedState extends SharedState {
  /** The full incoming A2A Message object received by the server handler. */
  __a2a_incoming_message?: Message;
  /** An array of Parts intended for the final A2A response message in tasks/send. */
  __a2a_final_response_parts?: Part[];
  /** @deprecated Use __a2a_incoming_message and access parts directly. Retained for backward compatibility with old shared.input convention.*/
  input?: unknown; // Add back the old 'input' convention, typed as unknown for flexibility

  // Add A2A history type hint if needed, although __a2a_history might be added by PocketMesh core depending on version
  /** Conversation history managed by the A2A server handler. */
  __a2a_history?: Message[];
}

// --- Utility: Type guard for Part ---

export function isTextPart(part: Part): part is TextPart {
  return part.type === "text";
}
export function isFilePart(part: Part): part is FilePart {
  return part.type === "file";
}
export function isDataPart(part: Part): part is DataPart {
  return part.type === "data";
}
