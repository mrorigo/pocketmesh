import {
  SendTaskRequest,
  SendTaskResponse,
  SendTaskStreamingRequest,
  AgentCard,
  Message,
  Task,
  TaskStatus,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  JSONRPCError,
} from "./types";
import type { Flow, SharedState, Params } from "../index";
import type { Persistence } from "../utils/persistence";
import { sqlitePersistence } from "../utils/persistence";
import { SendTaskRequestSchema, SendTaskStreamingRequestSchema, GetTaskRequestSchema } from "./validation";
import { logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response } from "express";

export interface A2AServerContext {
  flows: Record<string, Flow<any, any, any, any>>;
  agentCard: AgentCard;
  persistence?: Persistence; // DI for persistence
}

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
           return {
             jsonrpc: "2.0",
             id: req.id,
             error: {
               code: -32603,
               message: "Streaming requires HTTP response object",
               data: null,
             },
           };
         }
       // TODO: Add cancel, push notification, etc.
       default:
         return {
           jsonrpc: "2.0",
           id: req.id,
           error: {
             code: -32601,
             message: "Method not found",
             data: null,
           },
         };
     }
   } catch (err) {
     logger.error("[A2A] Validation or internal error:", err);
     return {
       jsonrpc: "2.0",
       id: req.id ?? null,
       error: {
         code: -32602,
         message: "Invalid parameters or internal error",
         data: (err as Error).message,
       },
     };
   }
 }

/**
 * Handle tasks/send: Start or continue a PocketFlow run for the requested skill.
 */
 async function handleSendTask(
   req: SendTaskRequest,
   context: A2AServerContext,
   persistence: Persistence
 ): Promise<SendTaskResponse> {
   const { id: taskId, message, metadata } = req.params;
   const skillIdRaw = metadata?.skillId || context.agentCard.skills[0]?.id;
   const skillId =
     typeof skillIdRaw === "string" ? skillIdRaw : String(skillIdRaw ?? "");
   const flow = context.flows[skillId];
   if (!flow) {
     return {
       jsonrpc: "2.0",
       id: req.id,
       error: {
         code: -32001,
         message: `Skill '${skillId}' not found`,
         data: null,
       },
     };
   }
 
   // Check if this is a new or continuing task
   let runId = persistence.getRunIdForA2ATask(taskId);
   let shared: SharedState = {};
   let history: Message[] = [];
 
   // Always set input from latest message (fixes "No input" bug)
   const firstText = message.parts.find((p) => p.type === "text") as
     | { text: string }
     | undefined;
   if (firstText) shared.input = firstText.text;
 
   let appendAgentMsg = false;
   if (runId === undefined) {
     // New task: create run, map taskId, initialize shared state
     runId = persistence.createRun(skillId);
     persistence.mapA2ATaskToRun(taskId, runId);
     // History: start with just the new message
     history = [message];
     appendAgentMsg = true;
   } else {
     // Continuing task: load last shared state and history
     const lastStep = persistence.getLastStep(runId);
     if (lastStep) {
       shared = JSON.parse(lastStep.shared_state_json);
     }
     history = (shared.__a2a_history as Message[]) || [];
     // Only append if the last user message is not the same as the new one
     // Find the last user message in history
     let lastUserIdx = -1;
     for (let i = history.length - 1; i >= 0; --i) {
       if (history[i].role === "user") {
         lastUserIdx = i;
         break;
       }
     }
     const lastUserMsg = lastUserIdx >= 0 ? history[lastUserIdx] : undefined;
     if (!lastUserMsg || JSON.stringify(lastUserMsg) !== JSON.stringify(message)) {
       history.push(message);
       appendAgentMsg = true;
     }
   }
 
   // Run the flow (synchronously for now)
   await flow.runLifecycle(shared, {});
 
   // Compose agent response message
   const lastEcho =
     typeof shared.lastEcho === "string" ? shared.lastEcho : "Done";
   const agentMsg: Message = {
     role: "agent",
     parts: [{ type: "text", text: lastEcho }],
   };
   if (appendAgentMsg) {
     history.push(agentMsg);
   }
 
   // Save updated history in shared state
   shared.__a2a_history = history;
 
   // Persist step
   persistence.addStep(runId, "A2A", "completed", history.length, shared);
 
   // Compose A2A Task response
   const task: Task = {
     id: taskId,
     status: {
       state: "completed",
       message: agentMsg,
       timestamp: new Date().toISOString(),
     },
     artifacts: [],
     history,
     metadata: {},
   };
   return {
     jsonrpc: "2.0",
     id: req.id,
     result: task,
   };
 }

/**
 * Handle tasks/get: Retrieve task status/history.
 */
 async function handleGetTask(
   req: any,
   context: A2AServerContext,
   persistence: Persistence
 ): Promise<any> {
   const { id: taskId } = req.params;
   const runId = persistence.getRunIdForA2ATask(taskId);
   if (!runId) {
     return {
       jsonrpc: "2.0",
       id: req.id,
       error: {
         code: -32001,
         message: `Task '${taskId}' not found`,
         data: null,
       },
     };
   }
   const lastStep = persistence.getLastStep(runId);
   if (!lastStep) {
     return {
       jsonrpc: "2.0",
       id: req.id,
       error: {
         code: -32001,
         message: `Task '${taskId}' not found`,
         data: null,
       },
     };
   }
   const shared = JSON.parse(lastStep.shared_state_json);
   const lastEcho =
     typeof shared.lastEcho === "string" ? shared.lastEcho : "Done";
   const history: Message[] = (shared.__a2a_history as Message[]) || [
     {
       role: "agent",
       parts: [{ type: "text", text: lastEcho }],
     },
   ];
   const agentMsg: Message = {
     role: "agent",
     parts: [{ type: "text", text: lastEcho }],
   };
   const task: Task = {
     id: taskId,
     status: {
       state: "completed",
       message: agentMsg,
       timestamp: lastStep.created_at,
     },
     artifacts: [],
     history,
     metadata: {},
   };
   return {
     jsonrpc: "2.0",
     id: req.id,
     result: task,
   };
 }

/**
 * Handle tasks/sendSubscribe: Streaming via Server-Sent Events (SSE).
 * Emits TaskStatusUpdateEvent(s) as the flow progresses.
 */
 async function handleSendSubscribe(
   req: SendTaskStreamingRequest,
   context: A2AServerContext,
   res: SSEExpressResponse,
   persistence: Persistence
 ) {
   // Set SSE headers
   res.setHeader("Content-Type", "text/event-stream");
   res.setHeader("Cache-Control", "no-cache");
   res.setHeader("Connection", "keep-alive");
   res.flushHeaders?.();
 
   const { id: taskId, message, metadata } = req.params;
   const skillIdRaw = metadata?.skillId || context.agentCard.skills[0]?.id;
   const skillId =
     typeof skillIdRaw === "string" ? skillIdRaw : String(skillIdRaw ?? "");
   const flow = context.flows[skillId];
   if (!flow) {
     sendSSE(res, {
       id: req.id,
       error: {
         code: -32001,
         message: `Skill '${skillId}' not found`,
         data: null,
       },
     });
     res.end();
     return;
   }
 
   // Check if this is a new or continuing task
   let runId = persistence.getRunIdForA2ATask(taskId);
   let shared: SharedState = {};
   let history: Message[] = [];
 
   // Always set input from latest message (fixes "No input" bug)
   const firstText = message.parts.find((p) => p.type === "text") as
     | { text: string }
     | undefined;
   if (firstText) shared.input = firstText.text;
 
   let appendAgentMsg = false;
   if (runId === undefined) {
     runId = persistence.createRun(skillId);
     persistence.mapA2ATaskToRun(taskId, runId);
     // History: start with just the new message
     history = [message];
     appendAgentMsg = true;
   } else {
     const lastStep = persistence.getLastStep(runId);
     if (lastStep) {
       shared = JSON.parse(lastStep.shared_state_json);
     }
     history = (shared.__a2a_history as Message[]) || [];
     // Only append if the last user message is not the same as the new one
     let lastUserIdx = -1;
     for (let i = history.length - 1; i >= 0; --i) {
       if (history[i].role === "user") {
         lastUserIdx = i;
         break;
       }
     }
     const lastUserMsg = lastUserIdx >= 0 ? history[lastUserIdx] : undefined;
     if (!lastUserMsg || JSON.stringify(lastUserMsg) !== JSON.stringify(message)) {
       history.push(message);
       appendAgentMsg = true;
     }
   }
 
   // Emit "submitted" event
   sendSSE(res, {
     id: taskId,
     status: {
       state: "submitted",
       message,
       timestamp: new Date().toISOString(),
     },
     final: false,
   });
 
   // --- SOTA: Hook into flow progress and artifact events ---
   let lastAgentMsg: Message | undefined;
 
   flow.onStatusUpdate = (status) => {
     let a2aState: TaskState = "working";
     if (status.state === "working") a2aState = "working";
     if (status.state === "completed") a2aState = "working"; // We'll emit "completed" at the end
     sendSSE(res, {
       id: taskId,
       status: {
         state: a2aState,
         message: status.message
           ? { role: "agent", parts: [{ type: "text", text: status.message }] }
           : undefined,
         timestamp: new Date().toISOString(),
       },
       final: false,
     });
   };
 
   flow.onArtifact = (artifact) => {
     sendSSE(res, {
       id: taskId,
       artifact,
     });
   };
 
   // Run the flow (real streaming: events emitted as flow progresses)
   await flow.runLifecycle(shared, {});
 
   // Compose agent response message
   const lastEcho =
     typeof shared.lastEcho === "string" ? shared.lastEcho : "Done";
   lastAgentMsg = {
     role: "agent",
     parts: [{ type: "text", text: lastEcho }],
   };
   if (appendAgentMsg) {
     history.push(lastAgentMsg);
   }
   shared.__a2a_history = history;
 
   // Persist step
   persistence.addStep(runId, "A2A", "completed", history.length, shared);
 
   // Emit "completed" event
   sendSSE(res, {
     id: taskId,
     status: {
       state: "completed",
       message: lastAgentMsg,
       timestamp: new Date().toISOString(),
     },
     final: true,
   });
 
   res.end();
 }

 /**
  * Helper: Send SSE event (as JSON) to client.
  * The Response type is extended to include an optional flush() method,
  * which is provided by compression or similar middleware for SSE.
  */
 type SSEExpressResponse = Response & { flush?: () => void };
 
 function sendSSE(res: SSEExpressResponse, event: object) {
   res.write(`data: ${JSON.stringify(event)}\n\n`);
   // Ensure the event is flushed immediately (important for Node.js/Express)
   if (typeof res.flush === "function") {
     res.flush();
   }
 }
