# PocketMesh v0.3.0 Migration Guide

PocketMesh 0.3.0 replaces the bespoke A2A implementation with the official [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk), refreshes the runtime helpers, and expands test coverage. This document highlights the breaking changes and provides concrete steps to upgrade from the 0.2.x line.

---

## TL;DR

- ✅ **Official SDK adoption:** All A2A server/client behaviour now routes through `@a2a-js/sdk` (`DefaultRequestHandler`, `A2AExpressApp`, `A2AClient`, …).
- ✅ **New server helpers:** `createPocketMeshA2AServer` + `a2aServerHandler` wire PocketMesh flows into the SDK event bus and task store.
- ✅ **Async client wrapper:** `createA2AClient` returns a promise that resolves to the SDK client. Use `sendMessage`/`sendMessageStream` instead of the deprecated `sendTask`/`sendSubscribe`.
- ✅ **Task persistence:** `PocketMeshTaskStore` synchronises the SDK’s Task states with the PocketMesh SQLite persistence by default.

---

## Breaking Changes

| Area | What changed | How to migrate |
| --- | --- | --- |
| A2A client | `createA2AClient(agentUrl)` now returns `Promise<A2AClient>` | `const client = await createA2AClient(url);` |
| | The old helper methods (`sendTask`, `getTask`, `sendSubscribe`) were removed | Switch to the SDK API:<br>`client.sendMessage({ message, configuration })`<br>`client.sendMessageStream({ … })`<br>`client.getTask({ id })`, `client.cancelTask({ id })`, etc. |
| A2A server | The custom `handleA2ARequest` implementation and Zod validators were removed | Use `a2aServerHandler({ flows, agentCard, persistence? })` (or `createPocketMeshA2AServer`) to register SDK-powered routes. |
| | Streaming + push-notification plumbing is now handled by `@a2a-js/sdk` | The handler automatically exposes JSON-RPC, SSE streaming, and optional push-notification endpoints. |
| AgentCard | `generateAgentCard` now expects the stricter schema exported by the SDK | Ensure skills include the required fields (e.g., `tags`, `inputModes`, `outputModes`). |
| Imports | Deep imports such as `"pocketmesh/a2a/server"` no longer exist | Use the barrel: `import { a2aServerHandler, createPocketMeshA2AServer } from "pocketmesh/a2a";` |

---

## Step-by-Step Upgrade

1. **Update the dependency:**
   ```bash
   npm install pocketmesh@^0.3.0 @a2a-js/sdk
   ```

2. **Refresh agent/server wiring:**
   ```ts
   import {
     generateAgentCard,
     a2aServerHandler,
   } from "pocketmesh/a2a";

   const agentCard = generateAgentCard({ /* … */ });
   a2aServerHandler({ flows: { greet: flow }, agentCard })(app, "/a2a");
   ```
   - Optional: call `createPocketMeshA2AServer` if you need direct access to the task store, executor, or `A2AExpressApp`.

3. **Update client usage:**
   ```ts
   import { createA2AClient } from "pocketmesh/a2a";

   const client = await createA2AClient("https://agent.example.com");
   const response = await client.sendMessage({
     message: { /* A2A message */ },
     configuration: { blocking: true },
   });
   ```
   - For streaming: iterate over `client.sendMessageStream({ … })` with `for await`.

4. **Adjust custom persistence (if any):**
   - The SDK now expects a `TaskStore`. PocketMesh ships with `PocketMeshTaskStore`, but you can provide your own as long as it fulfils the SDK interface.
   - Custom persistence modules must implement the new `saveTaskSnapshot` / `getTaskSnapshot` helpers if they previously extended PocketMesh internals.

5. **Review AgentCard definitions:**
   - The official schema mandates additional fields (`tags`, `inputModes`, `outputModes`, `provider.url`, etc.). Update any hand-crafted cards to satisfy the stricter types.

6. **Re-run tests & coverage:**
   ```bash
   npm test -- --coverage
   ```
   - New suites cover failure branches, batch fallbacks, persistence, and the SDK integration helpers.

---

## New Capabilities

- **PocketMeshExecutor** publishes flow status, artifacts, and final messages directly to the SDK `ExecutionEventBus`.
- **PocketMeshTaskStore** mirrors the SDK `TaskStore` contract, storing snapshots in SQLite out-of-the-box.
- **Async streaming loops**: `sendMessageStream` and `resubscribeTask` run as async generators—perfect for long-running flows, artifacts, and cancellations.
- **Improved documentation**: README sections reflect the new APIs, and this migration guide captures the required changes.

---

## Need Help?

Open an issue on the [PocketMesh repository](https://github.com/mrorigo/pocketmesh) or start a discussion if you encounter migration edge cases. Happy upgrading!
