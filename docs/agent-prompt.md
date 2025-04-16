---
layout: default
title: "Agentic Coding (TypeScript) — PocketMesh + A2A"
---

# Agentic Coding: Humans Design, Agents Code! (PocketMesh + A2A Edition)

> **If you are an AI agent or developer building LLM systems with the TypeScript PocketMesh framework, this is your gold-standard guide.**
> Follow these best practices to build robust, interoperable, and multi-agent systems using PocketMesh and the Agent2Agent (A2A) protocol.

---

## Best Practices (Read First!)

- **Unified Imports:** **Always import from the main package barrel:**
  `import { Flow, BaseNode } from "pocketmesh";`
  **Never import from deep paths like `pocketmesh/core/flow`, `src/core/`, or directly from `src/index.ts`.**
- **Strict Typing:** Use TypeScript generics and interfaces everywhere. Avoid `any` and `unknown` unless absolutely necessary.
- **Extensible & AI-Friendly:** Use dependency injection for persistence, logging, and protocol adapters. Keep your code modular and composable.
- **Robust Error Handling:** Use custom error classes, always log stack traces, and handle all error cases.
- **Comprehensive Testing:** Write and extend Jest tests for all custom nodes and flows.
  See the [Testing](#testing) section below.
- **Batch Nodes:** If you implement `executeItem`, you **must** also implement a dummy `execute` to satisfy TypeScript:
  ```ts
  async execute() { throw new Error("Not used in batch node"); }
  ```
- **Action Routing:** For linear flows, always return `"default"` (or `null`) from `finalize`. For branching, return the action string matching your successor.
- **Multi-turn:** Use `shared.__a2a_history` for message history. Return `"input-required"` to pause and resume flows.

---

## Overview

PocketMesh is a modern, type-safe, agentic workflow framework for TypeScript.
With **native A2A protocol support**, PocketMesh can expose its flows as open, discoverable agentic APIs and interoperate with other A2A-compliant agents (including those built on Google, OpenAI, CrewAI, LangGraph, etc.).

PocketMesh is modular, robust, and designed for reliability and extensibility. It features strict type safety, runtime validation, dependency injection for persistence and protocol layers, and comprehensive error handling and logging.

This guide covers **agentic coding best practices** and how to leverage A2A for multi-agent, multi-framework workflows, with details matching the actual implementation.

---

## Agentic Coding Steps (PocketMesh + A2A)

| Step                  | Human      | AI        | Comment                                                                 |
|:----------------------|:----------:|:---------:|:------------------------------------------------------------------------|
| 1. Requirements       | ★★★ High   | ★☆☆ Low   | Humans clarify requirements and context.                                 |
| 2. Flow Design        | ★★☆ Medium | ★★☆ Medium| Humans outline flows, AI fills in details.                               |
| 3. Utilities          | ★★☆ Medium | ★★☆ Medium| Humans provide APIs, AI implements TS utilities.                         |
| 4. Node Design        | ★☆☆ Low    | ★★★ High  | AI designs node types, state, and params.                                |
| 5. Implementation     | ★☆☆ Low    | ★★★ High  | AI implements flows, A2A skills, and integration.                       |
| 6. Optimization       | ★★☆ Medium | ★★☆ Medium| Humans evaluate, AI optimizes logic and prompts.                         |
| 7. Reliability        | ★☆☆ Low    | ★★★ High  | AI writes tests, handles retries, and ensures protocol compliance.       |

---

### 1. **Requirements**

- **Clarify the problem and user needs.**
- Decide if your agent should be discoverable and callable by other agents (A2A server), or if it should call out to other agents (A2A client), or both.
- **A2A Use Cases:**
  - Expose your agent’s skills to the world (A2A server).
  - Compose multi-agent workflows (A2A client).
  - Interoperate with other frameworks (Google, OpenAI, CrewAI, etc.).

---

### 2. **Flow Design**

- **Outline your agentic workflow** using PocketMesh’s modular node/flow abstractions.
- **For A2A:**
  - Each skill you want to expose must be a PocketMesh flow.
  - Each skill must be described in your AgentCard and registered in the `flows` map, keyed by skillId.
- **Design for multi-turn:**
  - If your agent requires user input mid-task, design nodes to return `"input-required"` and handle subsequent A2A messages with the same taskId.

**Example Mermaid Diagram:**
```mermaid
flowchart LR
    start[Start] --> skillA[Skill A (A2A)]
    skillA --> skillB[Skill B (A2A)]
    skillB --> end[End]
```

---

### 3. **Utilities**

- Implement utility functions for external APIs, LLM calls, file I/O, etc.
- **A2A Client Utility:**
  - Use `createA2AClient(agentUrl)` to call remote A2A agents as part of your flow.
  - Example:
    ```typescript
    import { createA2AClient } from "pocketmesh/a2a";
    const a2a = createA2AClient("https://other-agent.com/a2a");
    const resp = await a2a.sendTask(taskId, message, "skillId");
    ```
- **A2A Server Utility:**
  - Use `a2aServerHandler({ flows, agentCard })` to expose your flows as A2A skills.
  - The `flows` object must map skill IDs (as in AgentCard) to their corresponding PocketMesh flow instances.

---

### 4. **Node Design**

- **Shared State:**
  - Use `SharedState` (a strongly-typed object) to persist all relevant data, including A2A message history if needed.
  - **A2A Integration:** The A2A server will always set `shared.input` from the latest user message's text part before running the flow.
  - Message history is maintained in `shared.__a2a_history` (an array of Message objects).
- **Parameters:**
  - Use `Params` for node/flow configuration and runtime overrides.
- **Multi-turn:**
  - For multi-turn skills, store and update message history in `shared.__a2a_history`.
  - If your flow needs more input, return `"input-required"` in the Task state and handle subsequent `tasks/send` calls with the same taskId.

---

### 5. **Implementation**

#### **A2A Server (Expose Flows as Skills)**

1. **Define your skills as flows:**
```typescript
import { Flow, BaseNode } from "pocketmesh"; // Always use the main package barrel!
class EchoNode extends BaseNode { ... }
const echoFlow = new Flow(new EchoNode());
```

2. **Describe your skills in an AgentCard:**
    ```typescript
    import { generateAgentCard } from "pocketmesh/a2a";
    const agentCard = generateAgentCard({
      name: "My Agent",
      url: "https://myagent.com/a2a",
      version: "1.0.0",
      skills: [
        { id: "echo", name: "Echo", description: "Echoes input", inputModes: ["text"], outputModes: ["text"] }
      ],
      capabilities: { streaming: true, pushNotifications: false }
    });
    ```

3. **Expose your agent via HTTP (with pluggable persistence):**
    ```typescript
    import express from "express";
    import { a2aServerHandler } from "pocketmesh/a2a";
    import { myCustomPersistence } from "./my-persistence"; // optional

    const app = express();
    app.use(express.json());
    app.get("/.well-known/agent.json", (_req, res) => res.json(agentCard));
    app.post("/a2a", a2aServerHandler({
      flows: { echo: echoFlow },
      agentCard,
      persistence: myCustomPersistence, // <-- inject your own, or omit for SQLite
    }));
    ```

    - The `flows` map **must** use skill IDs as keys, matching those in the AgentCard.
    - The `persistence` option is **optional**; if omitted, SQLite is used by default.

#### **A2A Client (Call Other Agents as Nodes)**

- **Call remote A2A agents from a node:**
    ```typescript
    import { createA2AClient } from "pocketmesh/a2a";
    import { BaseNode } from "pocketmesh";
    class CallOtherAgentNode extends BaseNode {
      async execute(_prep, params) {
        const a2a = createA2AClient("https://other-agent.com/a2a");
        const resp = await a2a.sendTask("my-task-id", {
          role: "user",
          parts: [{ type: "text", text: params.input }]
        }, "skillId");
        return resp.result?.status?.message?.parts[0]?.text;
      }
    }
    ```

#### **Artifact Emission**

- To emit an artifact (file, data, etc.) from a node, **return an object with a `__a2a_artifact` property** from your `execute` or `executeItem` method:
    ```typescript
    async execute(prep, params) {
      // ... your logic ...
      return {
        result: "some result",
        __a2a_artifact: {
          name: "output.txt",
          parts: [{ type: "text", text: "Artifact content" }]
        }
      };
    }
    ```
- The A2A server will emit a `TaskArtifactUpdateEvent` for each artifact during streaming.

---

#### **Persistence and Multi-turn**

- **PocketMesh’s A2A server implementation persists all task state, history, and artifacts in SQLite (`pocketmesh.sqlite`) by default.**
- **A2A taskId is mapped to a persistent runId.**
- **Multi-turn (input-required):**
  - If your flow needs more input, return `"input-required"` in the Task state and handle subsequent `tasks/send` calls with the same taskId.
  - The server will resume the run, update `shared.input` from the new message, and append to `shared.__a2a_history`.
- **Custom Persistence (Pluggable):**
  - You can inject your own persistence layer by providing a custom implementation of the `Persistence` interface.
  - This works for both the A2A server and the `FlowStepper` utility.

---

### Pluggable Persistence Layer

PocketMesh allows you to use your own persistence backend by implementing the `Persistence` interface.

**Example: Using a custom persistence with FlowStepper**

```typescript
import { FlowStepper } from "pocketmesh/stepper";
import { myCustomPersistence } from "./my-persistence";

const stepper = new FlowStepper(
  {
    flowName: "my-flow",
    flowFactory: createMyFlow,
    persistence: myCustomPersistence, // <-- inject your own
  },
  sharedState,
  params
);
```

**Example: Using a custom persistence with the A2A server**

```typescript
import { a2aServerHandler } from "pocketmesh/a2a";
import { myCustomPersistence } from "./my-persistence";

app.post("/a2a", a2aServerHandler({
  flows,
  agentCard,
  persistence: myCustomPersistence, // <-- inject your own
}));
```

If you do not provide a `persistence` option, PocketMesh will use the built-in SQLite backend by default.

---

### 6. **Optimization**

- **Prompt Engineering:**
  - Use clear, structured prompts for LLM nodes.
- **Skill/Flow Modularity:**
  - Compose complex agents by chaining A2A skills (local or remote).
- **Streaming:**
  - For long-running tasks, implement streaming via `tasks/sendSubscribe` and SSE.
  - Use the production-quality streaming client pattern (see below).

---

### 7. **Reliability**

- **Retries and Fallbacks:**
  - Use `.setOptions({ maxRetries, waitSeconds, parallel })` on nodes.
- **Logging:**
  - PocketMesh provides built-in logging for node execution, retries, and errors.
- **A2A Protocol Compliance:**
  - All A2A requests and responses are persisted and recoverable.
  - Use `tasks/get` to retrieve task status/history at any time.
- **Error Handling:**
  - The server returns JSON-RPC error objects with appropriate codes for missing skills, invalid requests, etc.
  - All incoming A2A requests are validated at runtime using [zod](https://zod.dev/).

---
- **Error Handling:**
  - The server returns JSON-RPC error objects with appropriate codes for missing skills, invalid requests, etc.
  - All incoming A2A requests are validated at runtime using [zod](https://zod.dev/).

---

## Testing

PocketMesh includes a Jest-based test suite for core orchestration, node execution, and retry logic.

**To run all tests:**
```bash
npm test
```

- Tests are located in `__tests__/`.
- All core abstractions are covered: single-node, multi-node, batch, and retry/fallback flows.
- **To add your own tests:**
  Create a new `.test.ts` file in `__tests__/` and follow the examples.
  Always test custom nodes, flows, and error/retry logic.
- **AI agents:**
  When generating new nodes/flows, always generate or update tests to match.

---

## Example Project Structure (with A2A)

```filetree
my_project/
├── src/
│   ├── main.ts           # Entry point
│   ├── nodes.ts          # Node class definitions (all extend BaseNode)
│   ├── flow.ts           # Flow creation logic
│   ├── core/
│   │   ├── node.ts       # Core Node abstraction (all core logic lives here)
│   │   ├── flow.ts       # Core Flow abstraction
│   │   └── types.ts      # Shared types
│   ├── utils/
│   │   ├── logger.ts     # Logging utility
│   │   ├── retry.ts      # Retry utility
│   │   └── persistence.ts# Persistence (can be swapped)
│   └── a2a/
│       ├── index.ts      # A2A integration
│       ├── agentCard.ts  # AgentCard utilities
│       ├── client.ts     # A2A client
│       ├── server.ts     # A2A server
│       ├── types.ts      # A2A protocol types
│       └── validation.ts # Zod validation schemas
├── docs/
│   └── design.md         # High-level design document
├── package.json
├── tsconfig.json
└── pocketmesh.sqlite     # Persistent state (auto-created)
```

---

## Production-Quality Streaming Client Example

To receive real-time progress and artifact events from an A2A agent, use the `sendSubscribe` method with robust event and error handling.
**Requires [`undici`](https://www.npmjs.com/package/undici) for Node.js streaming fetch.**

```typescript
import { createA2AClient } from "pocketmesh/a2a/client";

// Create the client for the remote agent
const client = createA2AClient("http://localhost:4000/a2a");

const taskId = "my-streaming-task";
const message = {
  role: "user",
  parts: [{ type: "text", text: "Hello, stream!" }],
};

// Wait for streaming to finish before exiting
await new Promise<void>((resolve, reject) => {
  const close = client.sendSubscribe(
    taskId,
    message,
    "skillId", // or undefined
    (event) => {
      // Handle each streaming event (status or artifact)
      console.log("STREAM EVENT:", event);
      // Close and resolve when completed
      if ("status" in event && event.status?.state === "completed") {
        close();
        setTimeout(resolve, 100); // Ensure output flush
      }
    },
    (err) => {
      // Only log real errors (AbortError is suppressed in client)
      console.error("Streaming error:", err);
      reject(err);
    }
  );
});
```

**Notes:**
- The callback receives each `TaskStatusUpdateEvent` or `TaskArtifactUpdateEvent` as soon as it is emitted by the server.
- The returned `close` function aborts the stream.
- The client suppresses the expected `AbortError` on normal close.
- You must `npm install undici` for Node.js streaming support.
- The server emits progress events via `onStatusUpdate` and artifact events via `onArtifact` as the flow progresses.

---

## A2A Integration: Quick Reference

- **Expose flows as A2A skills:**
  - Register each skill as a flow in the `flows` map for `a2aServerHandler`, keyed by skillId.
  - Describe each skill in your AgentCard.
- **Call remote A2A agents:**
  - Use `createA2AClient(agentUrl)` in any node or utility.
  - **Persistence:**
    - All A2A tasks, runs, and message history are persisted in SQLite (`pocketmesh.sqlite`) by default.
    - You can inject a custom persistence implementation if needed.
    - A2A taskId is mapped to a persistent runId.
  - **Multi-turn:**
    - Use the same taskId for follow-up messages; PocketMesh resumes the run and updates history.
    - `shared.input` is always set from the latest user message's text part.
    - `shared.__a2a_history` is maintained and updated automatically.
  - **Streaming & Push:**
    - Implement `tasks/sendSubscribe` and push notification endpoints for advanced use cases.
    - Streaming requires SSE support on the server and `undici` on the client.

---

## Implementation Notes and Clarifications

- **Skill/Flow Mapping:** The `flows` map passed to `a2aServerHandler` must use skill IDs as keys, matching the `id` field in each AgentSkill in the AgentCard. If a skillId is not found, the server returns an error.
- **Imports:** All core logic lives in `src/core/`. The main entrypoint (`src/index.ts`) is a barrel export. **Always import from the main package barrel** (`import { Flow, BaseNode } from "pocketmesh"`), never from deep paths.
- **Persistence:** All A2A task state, including message history (`shared.__a2a_history`), is persisted in SQLite by default. The mapping between A2A taskId and internal runId is managed automatically. You can inject a custom persistence layer.
- **shared.input:** Before each flow run, the server sets `shared.input` to the latest user message's text part. This ensures nodes can always access the current input.
- **Artifacts:** To emit an artifact, return an object with a `__a2a_artifact` property from your node's `execute` or `executeItem` method. The server emits a `TaskArtifactUpdateEvent` for each artifact during streaming.
- **Streaming:** Streaming is implemented via SSE (`tasks/sendSubscribe`). The server emits progress and artifact events as the flow progresses. The client must use `undici` for streaming fetch in Node.js.
- **Multi-turn:** For multi-turn skills, the server maintains message history in `shared.__a2a_history`. If a node returns `"input-required"`, the server expects a follow-up `tasks/send` call with the same taskId and a new user message.
- **Error Handling:** The server returns JSON-RPC error objects with appropriate codes for missing skills, invalid requests, or internal errors. All incoming A2A requests are validated at runtime using [zod](https://zod.dev/).
- **Push Notifications:** Push notification endpoints are defined in the protocol but not implemented in the demo server. Streaming via SSE is fully supported.

---

## Further Reading

- [A2A Protocol Spec](https://google.github.io/A2A/)
- [PocketMesh Documentation](https://github.com/the-pocket/pocketflow) <!-- TODO: update to PocketMesh repo when available -->
- [PocketMesh Example Flows](./src/demo/)
- [PocketMesh A2A Demo](./src/demo/a2a/index.ts)

---

## Common Pitfalls

- **Deep Imports:**
  Don’t import from `pocketmesh/core/flow` or similar. Use the main package barrel.
- **Batch Node Abstract Error:**
  If you implement `executeItem` but not `execute`, TypeScript will error. Always add a dummy `execute`.
- **Action Mismatch:**
  If your `finalize` returns `"done"` but your successor is `"default"`, the flow will halt. Match action strings!
- **Missing Tests:**
  Don’t skip tests. Every node and flow should have a corresponding Jest test.
- **Forgetting Multi-turn State:**
  Always update `shared.__a2a_history` for multi-turn skills.

---

## AI Coding Tips

- **Docstrings:**
  Add docstrings to every class and method. This helps both humans and LLMs understand and refactor your code.
- **Type Inference:**
  Use TypeScript generics to make your flows and nodes type-safe and self-documenting.
- **Composable Patterns:**
  Favor composition (connecting nodes/flows) over inheritance for extensibility.
- **Testing First:**
  Generate tests alongside new code. Use the test suite as a spec for AI-driven refactoring.
- **Error Context:**
  Always include context in error messages for easier debugging and AI troubleshooting.
- **Keep Up to Date:**
  Reference the main [README](../README.md) for the latest API and architecture details.

---

**Agentic Coding = Human Design + Agent Implementation + Open Protocols (A2A)!**
---

**Agentic Coding = Human Design + Agent Implementation + Open Protocols (A2A)!**
