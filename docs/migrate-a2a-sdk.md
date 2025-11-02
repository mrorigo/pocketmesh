# Migrating PocketMesh to Official A2A SDK

## Overview

PocketMesh currently implements a custom A2A (Agent2Agent) protocol integration to enable its flows and nodes to act as A2A-compliant agents. This custom implementation handles server-side request processing, client interactions, persistence integration, and event emission (e.g., status updates and artifacts) while tightly coupling with PocketMesh's core abstractions like [`Flow`](src/core/flow.ts) and [`BaseNode`](src/core/node.ts).

The official A2A JavaScript SDK (`@a2a-js/sdk` v0.3.4, vendored in `pocketmesh/@a2a-js/sdk/`) provides a standardized, spec-compliant implementation for building A2A servers and clients. It emphasizes modularity with components like `AgentExecutor` for business logic, `DefaultRequestHandler` for JSON-RPC dispatching, `InMemoryTaskStore` (or custom stores) for state management, and `A2AExpressApp` for route setup. The SDK supports core A2A features: tasks, artifacts, streaming (SSE), cancellation, and push notifications.

## Current Implementation Highlights (Post-Migration)

- `src/a2a/PocketMeshTaskStore.ts`: Persists SDK `Task` snapshots into PocketMesh's SQLite persistence, keeping run status in sync.
- `src/a2a/PocketMeshExecutor.ts`: Bridges PocketMesh `Flow` execution with the SDK `ExecutionEventBus`, emitting `message`, `task`, `status-update`, and `artifact-update` events.
- `src/a2a/index.ts`: Exposes `createPocketMeshA2AServer`/`a2aServerHandler` helpers built on top of `DefaultRequestHandler` and `A2AExpressApp`.
- `src/a2a/types.ts` & `src/a2a/basenode.ts`: Re-export official spec types and update helpers to use the new `kind`-based discriminators.
- `src/a2a/client.ts`: Wraps the official `A2AClient`, providing an async `createA2AClient` factory.
- Demo (`src/demo/a2a/index.ts`) showcases the new server/client integration with `sendMessage`/`sendMessageStream`.

### Migration Goals
- **Replace Custom A2A Code**: Remove or refactor `src/a2a/` (server handlers, client, types) to use the official SDK, reducing maintenance overhead.
- **Maximize SDK Utilization**: Leverage `AgentExecutor` to wrap PocketMesh flows, official task storage for persistence, and built-in streaming/cancellation.
- **Preserve PocketMesh Core**: Keep `Flow`, `BaseNode`, persistence (`src/utils/persistence.ts`), and utils (logger, retry) unchanged. Map A2A concepts to PocketMesh:
  - Skills → Flows (via `Record<string, Flow>`).
  - Tasks → Flow runs (linked via persistence).
  - Artifacts/Events → Flow hooks (`onArtifact`, `onStatusUpdate`).
- **Benefits**: 
  - Compliance with A2A spec updates (e.g., v0.3.0+ features like push notifications).
  - Simplified server setup (fewer custom handlers).
  - Better interoperability with other A2A agents.
  - Focus on PocketMesh strengths: type-safe orchestration, batching, branching.
- **Scope**: Server migration replaces the custom `handleA2ARequest` stack with the SDK's `DefaultRequestHandler`/`A2AExpressApp` pipeline via new helpers (`createPocketMeshA2AServer`, `a2aServerHandler`). Client now re-exports the SDK `A2AClient` factory (breaking change for async initialization).

### Risks & Considerations
- **Persistence Integration**: Custom persistence must map to SDK's `TaskStore` interface (custom implementation needed).
- **Streaming & Events**: SDK uses `ExecutionEventBus` for publishing events; map to PocketMesh hooks.
- **Type Compatibility**: Official types (from spec) align closely with custom `src/a2a/types.ts`, but refine for PocketMesh extensions (e.g., `A2ASharedState`).
- **Version Lock**: SDK is vendored; plan for updates via npm (`npm install @a2a-js/sdk`).
- **Testing**: Existing tests (`__tests__/a2a/`) must be updated to use SDK; add integration tests for new features (e.g., cancellation).

## Deep Dive: Custom vs. Official Implementation

### 1. Custom PocketMesh A2A (src/a2a/)
PocketMesh's implementation is a from-scratch JSON-RPC server tailored to its orchestration model. Key files:

- **`src/a2a/index.ts` (Lines 1-64)**: Barrel exports and `a2aServerHandler` wrapper. Creates Express middleware calling `handleA2ARequest` from `server/handlers.ts`. Integrates persistence and logs errors. Usage: `app.post("/a2a", a2aServerHandler({ flows, agentCard }))`.

- **`src/a2a/types.ts` (Lines 1-369)**: A2A spec types (AgentCard, Message, Task, etc.) with PocketMesh extensions:
  - `A2ASharedState` extends `SharedState` with `__a2a_incoming_message?: Message`, `__a2a_final_response_parts?: Part[]`, `__a2a_history?: Message[]`, and deprecated `input?: unknown`.
  - Type guards: `isTextPart`, `isFilePart`, `isDataPart`.
  - JSON-RPC wrappers: `SendTaskRequest`, `GetTaskRequest`, etc.
  - Events: `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent`.

- **`src/a2a/agentCard.ts` (Lines 1-39)**: `generateAgentCard` helper builds `AgentCard` from opts (name, url, skills, capabilities). Defaults: input/output modes to `["text"]`.

- **`src/a2a/client.ts` (Lines 1-145)**: `createA2AClient(agentUrl)` returns:
  - `sendTask(taskId, message, skillId?)`: POST `tasks/send` via fetch.
  - `getTask(taskId)`: POST `tasks/get`.
  - `sendSubscribe(taskId, message, skillId?, onEvent, onError?)`: SSE via undici (Node.js). Parses stream, calls `onEvent` for updates, returns close function.
  - Limitations: No auth/retry; basic fetch (no custom headers).

- **Server Submodule (`src/a2a/server/`)**:
  - **`types.ts` (Lines 1-34)**: `A2AServerContext` (flows, agentCard, persistence?), `TaskExecutionState` (runId, shared, history, flow, etc.), `SSEExpressResponse`.
  - **`utils.ts` (Lines 1-83)**: `createJsonRpcError(id, code, message, data)`, `getFirstTextPart(message)`, `createTaskResponse(taskId, state, msg, history, artifacts, metadata)`.
  - **`taskManager.ts` (Lines 1-366)**: Core logic.
    - `initializeOrLoadTaskState(taskId, message, metadata, context, persistence)`: Maps A2A task to PocketMesh run (via persistence). Sets `shared.__a2a_*` props. Persists init step for new tasks.
    - `runFlowAndPersist(taskId, state, persistence, sseEmitter?)`: Hooks `flow.onStatusUpdate`/`onArtifact` for events (emit SSE or collect). Runs `flow.runLifecycle(shared, {})`. Composes `finalAgentMsg` from `__a2a_final_response_parts` or fallbacks (`lastEcho` or "Flow completed."). Updates history, persists final step. Throws on error.
  - **`handlers.ts` (Lines 1-520)**: `handleA2ARequest(req, context, expressReq?, expressRes?)` dispatches JSON-RPC:
    - Validates via Zod (`SendTaskRequestSchema`, etc.).
    - `tasks/send`: Init/load state → run flow → return `Task` (with artifacts/history).
    - `tasks/get`: Load run/steps → return `Task` (history truncated if `historyLength`).
    - `tasks/sendSubscribe`: SSE setup → init/load → run flow (emit events) → final "completed" event.
    - Errors: Zod → -32600; others → -32603. Streaming returns `undefined` (res handled).
  - **`index.ts` (Lines 1-2)**: Re-exports `handleA2ARequest`.

- **Integration with PocketMesh Core**:
  - Flows run via `runLifecycle(shared, {})`; shared populated with A2A context.
  - Persistence (`sqlitePersistence` default): Links taskId ↔ runId; stores steps with `shared_state_json` (incl. `__a2a_history`).
  - Events: Nodes emit via `this.flow?.onArtifact(artifact)` or `this.flow?.onStatusUpdate({node, state, message})`.
  - Validation: Zod schemas in `src/a2a/validation.ts` (not read, but inferred).

- **Dependencies**: Express (peer), undici (client streaming), uuid, zod, winston (logger).

- **Strengths**: Deep PocketMesh integration (e.g., batch nodes, branching via shared state).
- **Limitations**: Custom JSON-RPC parsing; no built-in task store/cancellation; partial spec support (no push notifications, resubscribe).

### 2. Official A2A SDK (@a2a-js/sdk)
Vendored from Google A2A repo (Apache 2.0). Focuses on protocol compliance without domain-specific logic.

- **Core Components** (from README and package.json):
  - **Server**:
    - `AgentExecutor`: Interface with `async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void>` and `cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void>`.
      - `RequestContext`: {taskId, contextId, message?}.
      - `ExecutionEventBus`: Methods like `publish(event)` (Task, Message, StatusUpdate, ArtifactUpdate), `finished()`.
    - `DefaultRequestHandler(agentCard, taskStore, agentExecutor, eventBusManager?, pushStore?, pushSender?, extendedCard?)`: Handles JSON-RPC (tasks/send, get, sendSubscribe, cancel, pushNotification/*).
    - `TaskStore`: Interface for persistence (e.g., `InMemoryTaskStore`; custom needed for SQLite).
      - Methods: createTask, getTask, updateTaskStatus, addArtifact, etc.
    - `A2AExpressApp(handler)`: Sets up Express routes (`/.well-known/agent.json` for card, `/` for POST JSON-RPC). Handles SSE for streaming.
    - Push: `InMemoryPushNotificationStore`, `DefaultPushNotificationSender` (outbound webhooks).
  - **Client**:
    - `A2AClient.fromCardUrl(url, {fetchImpl?})`: Fetches AgentCard, returns client.
    - `sendMessage(params: MessageSendParams)`: POST `tasks/send` (returns Task or Message).
    - `sendMessageStream(params)`: AsyncGenerator for SSE events (TaskStatusUpdateEvent, ArtifactUpdateEvent).
    - Auth/Retry: `createAuthenticatingFetchWithRetry(fetch, handler)` for Bearer tokens, 401 retries.
  - **Types**: Auto-generated from spec (`specification/json/a2a.json`). Matches custom types (AgentCard, Message with Parts: text/file/data, Task with status/artifacts/history).
  - **Features**:
    - Streaming: SSE via `sendSubscribe` (events: task, status-update, artifact-update).
    - Cancellation: Client calls cancel; server `cancelTask` publishes "canceled" event.
    - Artifacts: Multi-part (text/data/file); appended via events.
    - Push: Client provides webhook; server notifies on updates (if `capabilities.pushNotifications: true`).
    - Validation: Built-in (Zod? inferred from samples).

- **Dependencies**: uuid (core); express (peer for server); undici (implied for fetch).

- **Strengths**: Spec-compliant, modular (easy custom TaskStore/Executor), full feature set (push, resubscribe).
- **Limitations**: No built-in orchestration (needs wrapping for PocketMesh); in-memory store default (custom for persistence).

### Key Differences
| Aspect | Custom (PocketMesh) | Official SDK |
|--------|---------------------|--------------|
| **Server Setup** | Custom `handleA2ARequest` + Express middleware. | `DefaultRequestHandler` + `A2AExpressApp.setupRoutes(app)`. |
| **Logic Entry** | `runFlowAndPersist` hooks Flow, runs `runLifecycle`. | `AgentExecutor.execute` publishes to `eventBus`; handler orchestrates. |
| **Persistence** | PocketMesh SQLite (runs ↔ tasks). | `TaskStore` interface (custom impl needed). |
| **Events/Streaming** | Custom SSE in `handleSendSubscribe`; hooks `onStatusUpdate`/`onArtifact`. | `eventBus.publish`; built-in SSE in handler. |
| **Client** | Basic fetch/undici. | `A2AClient` with auth/retry, stream generator. |
| **Cancellation** | Not implemented. | `cancelTask` + client cancel. |
| **Push Notifications** | Not implemented. | Built-in store/sender. |
| **Types** | Extended for PocketMesh (`A2ASharedState`). | Pure spec; extend as needed. |
| **Validation** | Zod schemas. | Built-in (JSON schema-based). |

- **Overlap**: Both use JSON-RPC 2.0, same core types (Task, Message, etc.), Express for server.
- **Gaps in Custom**: Missing cancel/push; custom event mapping; no standard TaskStore.

## Detailed Migration Plan

### Phase 1: Preparation (Analysis & Setup)
1. **Update Dependencies** (`package.json` Lines 55-64):
   - Install official SDK: `npm install @a2a-js/sdk`.
   - Remove vendored `@a2a-js/sdk/` (or keep as fallback).
   - Ensure peer deps: express ^5.1.0.
   - Add types: `@types/express`.

2. **Refine Types** (`src/a2a/types.ts`):
   - Import official types: `import type { AgentCard, Task, ... } from "@a2a-js/sdk"`.
   - Keep PocketMesh extensions (`A2ASharedState`).
   - Deprecate custom JSON-RPC wrappers; use SDK's.
   - Update validation: Align Zod with SDK schemas if needed.

3. **Audit Current Usage**:
   - Search for custom A2A imports: `grep -r "from \"pocketmesh/a2a\"" src/ docs/`.
   - Update README.md (Lines 145-168, 178-196, 202-231): Replace examples with SDK (`A2AClient.fromCardUrl`, `AgentExecutor`).
   - Update demos (`src/demo/a2a/index.ts`): Use SDK server/client.

### Phase 2: Server Migration (Replace Custom Handlers)
1. **Implement Custom TaskStore** (New: `src/a2a/TaskStore.ts`):
   - Extend SDK's `TaskStore` interface.
   - Map to PocketMesh persistence:
     - `createTask(task)`: Create run, map taskId ↔ runId, persist init step.
     - `getTask(taskId)`: Load run/steps, reconstruct Task (status from run.status, history/artifacts from shared).
     - `updateTaskStatus(taskId, status)`: Update run status, emit event if needed.
     - `addArtifact(taskId, artifact)`: Append to shared.artifacts, persist step.
     - Handle history: Store/load `__a2a_history` in shared.
   - Use `sqlitePersistence` internally.
   - Fallback: InMemoryTaskStore for tests.

2. **Implement PocketMeshExecutor** (New: `src/a2a/PocketMeshExecutor.ts`):
   - Class implements `AgentExecutor`.
   - Constructor: `{ flows: Record<string, Flow>, persistence: Persistence }`.
   - `execute(requestContext, eventBus)`:
     - Extract skillId from metadata or default.
     - Get flow = flows[skillId].
     - Init/load state via custom helper (adapt `initializeOrLoadTaskState`).
     - Hook eventBus: `eventBus.publish` → flow.onStatusUpdate/onArtifact.
     - Run `flow.runLifecycle(shared, {})`.
     - Compose final msg (from shared), publish TaskStatusUpdateEvent (completed, final: true).
     - Collect/publish artifacts via eventBus.
   - `cancelTask(taskId, eventBus)`:
     - Load runId, set run status "canceled".
     - Publish "canceled" event.
     - If flow supports, signal abort (e.g., via shared.__cancel = true; nodes check in loops).

3. **Update Server Handler** (`src/a2a/index.ts`):
   - Replace `a2aServerHandler`:
     ```ts
     import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
     import { A2AExpressApp } from "@a2a-js/sdk/server/express";
     import { PocketMeshExecutor } from "./PocketMeshExecutor";
     import { PocketMeshTaskStore } from "./TaskStore"; // Custom

     export function a2aServerHandler(opts: { flows: Record<string, Flow>; agentCard: AgentCard; persistence?: Persistence }) {
       const taskStore = new PocketMeshTaskStore(opts.persistence);
       const executor = new PocketMeshExecutor({ flows: opts.flows, persistence: opts.persistence });
       const handler = new DefaultRequestHandler(opts.agentCard, taskStore, executor);
       return new A2AExpressApp(handler).setupRoutes; // Returns app builder
     }
     ```
   - Remove `server/handlers.ts`, `taskManager.ts` (logic → Executor/TaskStore).
   - Keep `utils.ts` if needed for helpers (e.g., `getFirstTextPart`).

4. **AgentCard & Capabilities** (`src/a2a/agentCard.ts`):
   - Update `generateAgentCard`: Set `capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true }` if implementing push.
   - Expose `/.well-known/agent.json` via SDK (automatic).

5. **Persistence Updates** (`src/utils/persistence.ts`):
   - Add methods if needed: e.g., `getArtifactsForRun(runId)` (from shared).
   - Ensure shared_state_json serializes `__a2a_*` props.

6. **Event Mapping**:
   - In Executor: `eventBus.onStatusUpdate` → publish TaskStatusUpdateEvent.
   - Artifacts: Nodes emit → eventBus.publish(artifact-update).
   - Streaming: SDK handles SSE; Executor publishes to bus.

### Phase 3: Client Migration
1. **Replace createA2AClient** (`src/a2a/client.ts`):
   ```ts
   import { A2AClient } from "@a2a-js/sdk/client";

   export function createA2AClient(agentUrl: string) {
     return A2AClient.fromCardUrl(agentUrl); // Add { fetchImpl } for custom fetch if needed
   }
   ```
   - Update methods: `sendTask` → `sendMessage({ message, configuration: { metadata: { skillId } } })`.
   - Streaming: `sendSubscribe` → `sendMessageStream({ message })` (AsyncGenerator; adapt callback).
   - Add auth: Use `createAuthenticatingFetchWithRetry` for tokens.

2. **Update Demos/Tests**:
   - `src/demo/a2a/index.ts`: Use SDK client/server.
   - Tests (`__tests__/a2a/`): Mock Executor/TaskStore; test integration.

### Phase 4: Advanced Features
1. **Cancellation**:
   - In Executor: Track active runs (Map<taskId, AbortController>); `cancelTask` aborts, publishes "canceled".
   - Nodes: Check `shared.__cancel` in loops (e.g., retry).

2. **Push Notifications**:
   - Enable in AgentCard.
   - Use SDK's `DefaultPushNotificationSender` in handler.
   - On events (status/artifact), sender notifies client webhook.

3. **Resubscribe** (for long-running):
   - SDK supports `tasks/resubscribe`; TaskStore loads history.

### Phase 5: Testing & Validation
1. **Unit Tests**:
   - Executor: Mock flows, test execute publishes correct events.
   - TaskStore: Test task ↔ run mapping, artifact persistence.

2. **Integration Tests** (`__tests__/a2a/integration/`):
   - Spin up Express server with SDK.
   - Client sends tasks; assert Task responses, SSE events.
   - Cover: New/continue tasks, artifacts, errors, cancel.

3. **E2E**:
   - Run `npm run a2a-demo`; verify with curl or SDK client.
   - Interop: Test with official A2A samples.

4. **Lint/Build**: `npm run build`; fix type errors.

### Phase 6: Cleanup & Docs
1. **Remove Obsolete**:
   - Delete `src/a2a/server/` (handlers, taskManager).
   - Deprecate custom types if fully replaced.
   - Update `tsconfig.json`, jest.config.

2. **Update Docs**:
   - README.md: New examples with SDK.
   - `docs/agent-prompt.md`: Mention SDK for A2A compliance.
   - This file: Track migration status.

3. **Version Bump** (`package.json`): v0.3.0; changelog: "Migrated to official A2A SDK".

### Timeline & Effort
- Phase 1-2: 1-2 days (core migration).
- Phase 3-4: 1 day (client + features).
- Phase 5-6: 1 day (tests/docs).
- Total: 3-4 days; low risk due to modular SDK.

This plan ensures a seamless transition, leveraging the SDK for protocol handling while preserving PocketMesh's agentic workflow strengths.
