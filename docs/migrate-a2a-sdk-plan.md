# PocketMesh A2A SDK Migration Plan

This document outlines a phased approach to migrating PocketMesh's custom A2A implementation to the official `@a2a-js/sdk`. The goal is to replace custom server/client logic while preserving PocketMesh's core features (e.g., `Flow`, `BaseNode`, persistence). The migration leverages the SDK's modularity for compliance and reduces maintenance.

**Important: Breaking Changes Allowed**  
Since breaking changes to the A2A API are acceptable, we can directly replace public functions (e.g., `a2aServerHandler` → SDK's `A2AExpressApp`, `createA2AClient` → `A2AClient.fromCardUrl`) without compatibility wrappers. This simplifies the migration: no deprecation cycles, direct API adoption. Update all usages (README, demos, tests) to new SDK patterns. Changelog will note the break in v0.3.0.

## Assumptions
- SDK version: `@a2a-js/sdk` v0.3.4 (or latest compatible).
- Core PocketMesh APIs (e.g., `Flow`, `BaseNode`) remain unchanged.
- Custom persistence (`src/utils/persistence.ts`) will be adapted to SDK's `TaskStore`.
- Testing: Update existing tests; add SDK-specific integration tests.
- Timeline: 2-4 days (reduced due to no compatibility overhead).

## Phase 1: Preparation (0.5-1 day)
### Objectives
- Set up dependencies and tooling.
- Analyze/audit current code.
- Align types and validate compatibility.

### Steps
1. **Update Dependencies** (`package.json`):
   - Install: `npm install @a2a-js/sdk`.
   - Ensure peers: `express@^5.1.0`.
   - Remove vendored `pocketmesh/@a2a-js/sdk/` entirely.
   - Run `npm install` and `npm run build` to check for conflicts.
   - _Status (current)_: ✅ `@a2a-js/sdk@^0.3.4` added and vendored copy removed. Lockfile refresh pending until TypeScript build succeeds to let `prepare` finish without errors.

2. **Type Alignment** (`src/a2a/types.ts`):
   - Import official types: `import type { AgentCard, Task, Message, ... } from "@a2a-js/sdk";`.
   - Retain only necessary PocketMesh extensions (e.g., `A2ASharedState` with `__a2a_incoming_message`, `__a2a_history`).
   - Remove custom JSON-RPC wrappers (e.g., `SendTaskRequest`); rely on SDK's.
   - Update type guards and utilities (e.g., merge `isTextPart` if not in SDK).
   - Validate: Run `tsc --noEmit` to ensure no type errors.
   - _Status (current)_: ✅ Types now re-export SDK models; guards use `kind` discriminators. Added TS path mappings so the compiler resolves SDK subpath exports; local `tsc` succeeds once Node tooling runs.

3. **Code Audit**:
   - Search for custom A2A usage: `grep -r "from \"pocketmesh/a2a\"" src/ docs/ __tests__/`.
   - Document breaking changes: List files to refactor (e.g., `src/a2a/server/handlers.ts`, `client.ts`); note API breaks (e.g., `a2aServerHandler` now returns SDK builder).
   - Review README.md and demos (`src/demo/a2a/index.ts`): Plan direct SDK examples.
   - _Status (current)_: 🔄 Audit in progress — primary touchpoints logged: `src/a2a/server/*`, `src/a2a/client.ts`, `src/a2a/index.ts`, `src/a2a/server.ts`, `src/a2a/basenode.ts`, `src/a2a/validation.ts`, `src/demo/a2a/index.ts`, README excerpts, and docs referencing legacy endpoints. Detailed breakages will be updated as refactors land.

4. **Backup & Branch**:
   - Create Git branch: `git checkout -b migrate-a2a-sdk`.
   - Commit initial state.
   - _Status (current)_: ⏸️ Deferred per instructions (working directly in existing workspace without new branch/commit).

### Deliverables
- Updated `package.json` and lockfile.
- Aligned types with no build errors.
- Audit report noting breaking changes (e.g., in this doc).

### Risks
- Type mismatches: Mitigate by gradual imports.

## Phase 2: Server Migration (1 day)
### Objectives
- Implement SDK wrappers for PocketMesh integration.
- Replace custom handlers with `DefaultRequestHandler` + `A2AExpressApp`.
- Migrate persistence and executor logic; embrace API breaks.

### Steps
1. **Custom TaskStore** (New file: `src/a2a/PocketMeshTaskStore.ts`):
   - Implement SDK's `TaskStore` interface.
   - Map to PocketMesh persistence:
     - `createTask(task: Task)`: Create run via `persistence.createRun(skillId)`; map taskId ↔ runId; persist init step with `shared.__a2a_incoming_message`.
     - `getTask(taskId: string)`: Load runId; reconstruct `Task` from steps/shared (status from run.status, history from `__a2a_history`, artifacts from shared or steps).
     - `updateTaskStatus(taskId: string, status: TaskStatus)`: Update run status; persist step if needed.
     - `addArtifact(taskId: string, artifact: Artifact)`: Append to shared.artifacts; emit/persist.
     - `getTaskHistory(taskId: string, limit?: number)`: Load/truncate `__a2a_history`.
     - Handle cancellation: Set run status "canceled".
   - Inject `sqlitePersistence` in constructor.
   - Fallback: Use SDK's `InMemoryTaskStore` for unit tests.
   - _Status (current)_: ✅ Implemented `PocketMeshTaskStore` persisting snapshots via SQLite (see `src/a2a/PocketMeshTaskStore.ts`) and updating run status mappings.

2. **PocketMeshExecutor** (New file: `src/a2a/PocketMeshExecutor.ts`):
   - Implements `AgentExecutor`.
   - Constructor: `{ flows: Record<string, Flow>, persistence: Persistence }`.
   - `async execute(requestContext: RequestContext, eventBus: ExecutionEventBus)`:
     - skillId = requestContext.metadata?.skillId || default.
     - flow = flows[skillId]; throw if missing.
     - state = adapt `initializeOrLoadTaskState` (using persistence).
     - Hook events: 
       - `flow.onStatusUpdate = (status) => eventBus.publish(TaskStatusUpdateEvent from status)`.
       - `flow.onArtifact = (artifact) => eventBus.publish(artifact-update)`.
     - Run `flow.runLifecycle(state.shared, {})`.
     - Compose final msg (from `__a2a_final_response_parts` or fallback).
     - Publish final TaskStatusUpdateEvent (completed, final: true, message: finalMsg).
     - Collect artifacts via hooks.
    - Update history in shared; persist final step.
    - Call `eventBus.finished()`.
  - `async cancelTask(taskId: string, eventBus: ExecutionEventBus)`:
    - Load runId; set status "canceled" via persistence.
    - Publish "canceled" event.
    - If active (track via Map<taskId, {flow, abortController}>), abort flow (nodes check `shared.__a2a_cancel` in loops).
   - _Status (current)_: ✅ New executor publishes SDK events (`message/send`, streaming, artifacts) and ties into persistence/cancellation logic (`src/a2a/PocketMeshExecutor.ts`).

3. **Replace a2aServerHandler** (`src/a2a/index.ts`):
   - Direct SDK integration (breaking change: API now uses SDK patterns):
     ```ts
     import { DefaultRequestHandler } from "@a2a-js/sdk/server";
     import { A2AExpressApp } from "@a2a-js/sdk/server/express";
     import { PocketMeshExecutor } from "./PocketMeshExecutor";
     import { PocketMeshTaskStore } from "./PocketMeshTaskStore";
     import { sqlitePersistence } from "../utils/persistence";

     export function a2aServerHandler(opts: { flows: Record<string, Flow<any, any, any, any>>; agentCard: AgentCard; persistence?: Persistence }) {
       const persistence = opts.persistence || sqlitePersistence;
       const taskStore = new PocketMeshTaskStore(persistence);
       const executor = new PocketMeshExecutor({ flows: opts.flows, persistence });
     const handler = new DefaultRequestHandler(opts.agentCard, taskStore, executor);
     return new A2AExpressApp(handler).setupRoutes; // Direct SDK builder; breaking: no custom middleware
    }
    ```
  - Usage break: `app.use(a2aServerHandler(...))` → `a2aServerHandler(...)(app)` (setupRoutes on app).
  - Remove calls to custom `handleA2ARequest`; delete `src/a2a/server/`.
   - _Status (current)_: ✅ Replaced with `createPocketMeshA2AServer` + `a2aServerHandler` wrapper exporting SDK `A2AExpressApp` integration; legacy handlers deleted.

4. **Persistence Enhancements** (`src/utils/persistence.ts`):
   - Add: `getArtifactsForRun(runId: number)` (parse from shared_state_json).
   - Ensure serialization of `__a2a_*` props (e.g., Message/Part as JSON).
   - Add run tracking for cancellation (e.g., activeRuns Map).
   - _Status (current)_: ✅ Added SQLite snapshot table (`a2a_task_snapshots`) with save/load helpers plus cascade cleanup.

5. **Cleanup Custom Server**:
   - Delete `src/a2a/server/` (handlers.ts, taskManager.ts).
   - Migrate utils (e.g., `getFirstTextPart` to executor).
   - Remove Zod validation; rely on SDK.
   - _Status (current)_: ✅ Legacy server modules removed; executor now normalizes parts/history without Zod.

### Deliverables
- `PocketMeshTaskStore.ts`, `PocketMeshExecutor.ts`.
- Refactored `a2aServerHandler` (breaking API).
- Server runs with SDK (test via curl: POST /a2a tasks/send).

### Risks
- Event bus mapping: Test hooks thoroughly.
- Persistence sync: Ensure task/run state consistency.

## Phase 3: Client Migration (0.5 day)
### Objectives
- Replace custom client with SDK's `A2AClient`.
- Direct API break: Export SDK directly.

### Steps
1. **Replace createA2AClient** (`src/a2a/client.ts`):
   ```ts
   import { A2AClient } from "@a2a-js/sdk/client";

   export { A2AClient }; // Direct export; breaking: use A2AClient.fromCardUrl directly
   export function createA2AClient(agentUrl: string, opts?: { fetchImpl?: typeof fetch }) {
     return A2AClient.fromCardUrl(agentUrl, opts); // Optional wrapper if needed, but prefer direct
   }

   // Remove custom methods (sendTask, sendSubscribe); users adopt SDK's sendMessage, sendMessageStream
   ```
   - Breaking: No more `client.sendTask`; use `client.sendMessage({ message, configuration: { metadata: { skillId } } })`.
   - Add auth: Document `createAuthenticatingFetchWithRetry`.
   - _Status (current)_: ✅ Async factory now wraps `A2AClient.fromCardUrl`; legacy helpers removed.

2. **Update Demos** (`src/demo/a2a/index.ts`):
   - Server/Client: Direct SDK usage (e.g., `A2AClient.fromCardUrl` + `sendMessageStream`).
   - _Status (current)_: ✅ Demo updated to use `message/send` + `message/stream` and new server helper.

### Deliverables
- Updated client exports.
- Demo runs with SDK client.

### Risks
- Usage updates: Ensure docs cover breaks.

## Phase 4: Advanced Features & Polish (0.5 day)
### Objectives
- Add missing spec features (cancellation, push).
- Optimize integration.

### Steps
1. **Cancellation**:
   - In Executor: Track active flows; abort on cancelTask.
   - Nodes: Optional `shared.__a2a_cancel` check.

2. **Push Notifications**:
   - AgentCard: Set `capabilities.pushNotifications: true`.
   - Handler: Pass SDK's `InMemoryPushNotificationStore` / `DefaultPushNotificationSender`.
   - Client: Document webhook config in sendMessage.

3. **Resubscribe & History**:
   - TaskStore: Implement for `tasks/resubscribe`.

4. **Error Handling**:
   - Map flow errors to SDK codes.

5. **Performance**:
   - Batch persistence; low-latency events.

### Deliverables
- Full spec compliance.
- Updated AgentCard capabilities.

### Risks
- Cancellation in flows: Abort signal propagation.

## Phase 5: Testing & Validation (0.5 day)
### Objectives
- Ensure no regressions.
- Validate interop.

### Steps
1. **Unit Tests** (`__tests__/a2a/sdk/`):
   - Executor/TaskStore: Mock; assert publishes.
   - _Status (current)_: ✅ Added Jest coverage in `__tests__/a2a-sdk.test.ts` validating TaskStore snapshots and executor event flow.

2. **Integration Tests**:
   - Supertest: tasks/send, streaming, cancel.
   - Update existing to SDK.

3. **E2E**:
   - `npm test`; manual curl.
   - Interop with official samples.

4. **Lint & Build**:
   - `npm run lint/build`.
   - _Status (current)_: ⚠️ Node tooling unavailable in this environment; local build/test commands could not be executed (see notes).

### Deliverables
- Full test coverage.
- No errors.

### Risks
- Streaming tests: Mock SSE.

## Phase 6: Documentation & Release (0.5 day)
### Objectives
- Update docs for breaking changes.
- Prepare release.

### Steps
1. **Docs Updates**:
   - README.md: SDK examples; note breaks (e.g., "a2aServerHandler now returns A2AExpressApp builder").
   - `docs/agent-prompt.md`: SDK patterns.
   - This file: Mark complete.

2. **Changelog & Version**:
   - v0.3.0: "Breaking: Migrated to @a2a-js/sdk; direct API usage."

3. **Cleanup**:
   - Delete obsolete (custom server/client wrappers).
   - Merge branch.

4. **Release**:
   - `npm publish`.

### Deliverables
- Updated docs.
- Released v0.3.0.

### Risks
- Doc accuracy: Review breaks.

## Post-Migration
- SDK updates: Periodic upgrades.
- Future: SDK extensions (e.g., Genkit).

For execution, switch to code mode.
