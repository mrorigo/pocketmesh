import type {
  A2ARequest,
  A2AResponse,
  AgentCard,
  AgentCardSignature,
  AgentCapabilities,
  AgentInterface,
  AgentProvider,
  AgentSkill,
  Artifact,
  CancelTaskRequest,
  CancelTaskResponse,
  DataPart,
  DeleteTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigSuccessResponse,
  FilePart,
  FileWithBytes,
  FileWithUri,
  GetAuthenticatedExtendedCardRequest,
  GetAuthenticatedExtendedCardResponse,
  GetTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigResponse,
  GetTaskRequest,
  GetTaskResponse,
  JSONRPCError,
  JSONRPCRequest,
  JSONRPCResponse,
  ListTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigSuccessResponse,
  Message,
  MessageSendConfiguration,
  MessageSendParams,
  Part,
  PushNotificationAuthenticationInfo,
  PushNotificationConfig,
  SecurityScheme,
  SendMessageRequest,
  SendMessageResponse,
  SendStreamingMessageRequest,
  SendStreamingMessageResponse,
  SetTaskPushNotificationConfigRequest,
  SetTaskPushNotificationConfigResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskIdParams,
  TaskPushNotificationConfig,
  TaskQueryParams,
  TaskResubscriptionRequest,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  TextPart,
} from "@a2a-js/sdk";

import type { SharedState } from "../core";

export type {
  A2ARequest,
  A2AResponse,
  AgentCard,
  AgentCardSignature,
  AgentCapabilities,
  AgentInterface,
  AgentProvider,
  AgentSkill,
  Artifact,
  CancelTaskRequest,
  CancelTaskResponse,
  DataPart,
  DeleteTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigSuccessResponse,
  FilePart,
  FileWithBytes,
  FileWithUri,
  GetAuthenticatedExtendedCardRequest,
  GetAuthenticatedExtendedCardResponse,
  GetTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigResponse,
  GetTaskRequest,
  GetTaskResponse,
  JSONRPCError,
  JSONRPCRequest,
  JSONRPCResponse,
  ListTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigSuccessResponse,
  Message,
  MessageSendConfiguration,
  MessageSendParams,
  Part,
  PushNotificationAuthenticationInfo,
  PushNotificationConfig,
  SecurityScheme,
  SendMessageRequest,
  SendMessageResponse,
  SendStreamingMessageRequest,
  SendStreamingMessageResponse,
  SetTaskPushNotificationConfigRequest,
  SetTaskPushNotificationConfigResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskIdParams,
  TaskPushNotificationConfig,
  TaskQueryParams,
  TaskResubscriptionRequest,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  TextPart,
} from "@a2a-js/sdk";

/**
 * SharedState augmented with A2A-specific properties populated by the server handler.
 * Nodes operating in an A2A context can expect these properties to be present.
 * Your custom shared state interface should extend this if using A2ABaseNode.
 */
export interface A2ASharedState extends SharedState {
  /** The full incoming A2A Message object received by the server handler. */
  __a2a_incoming_message?: Message;
  /** An array of Parts intended for the final A2A response message. */
  __a2a_final_response_parts?: Part[];
  /** @deprecated Use __a2a_incoming_message and access parts directly. Retained for backward compatibility. */
  input?: unknown;
  /** Conversation history managed by the A2A server handler. */
  __a2a_history?: Message[];
  /** Collected artifacts to include in persisted tasks. */
  __a2a_artifacts?: Artifact[];
  /** The PocketMesh skill identifier associated with the current task. */
  __a2a_skill_id?: string;
  /** The A2A context identifier associated with the current task. */
  __a2a_context_id?: string;
  /** The current task identifier bound to this shared state. */
  __a2a_task_id?: string;
}

// --- Utility: Type guard helpers for Part ---

export function isTextPart(part: Part): part is TextPart {
  return part.kind === "text";
}

export function isFilePart(part: Part): part is FilePart {
  return part.kind === "file";
}

export function isDataPart(part: Part): part is DataPart {
  return part.kind === "data";
}
