---
layout: default
title: "Agentic Coding (TypeScript) — PocketMesh + A2A v2.0"
---

# Agentic Coding: Humans Design, Agents Code! (PocketMesh + A2A v2.0 Edition)

> **If you are an AI agent or developer building LLM systems with the TypeScript PocketMesh framework, this is your gold-standard guide.**
> Follow these best practices to build robust, interoperable, and multi-agent systems using PocketMesh v2.0 and the Agent2Agent (A2A) protocol.

---

## Best Practices (Read First!)

- **Unified Imports:** **Always import core components from the main package barrel:**
  `import { Flow, BaseNode, SharedState, Params } from "pocketmesh";`
  **Import A2A-specific components (types, `A2ABaseNode`, handlers) from the distribution path:**
  `import { A2ABaseNode, Message, isDataPart } from "pocketmesh/dist/a2a";`
- **Strict Typing:** Use TypeScript generics and interfaces everywhere. Define specific `SharedState` interfaces. Avoid `any` and `unknown` unless absolutely necessary.
- **Extensible & AI-Friendly:** Use dependency injection for persistence, logging, etc. Keep your code modular and composable.
- **Robust Error Handling:** Use custom error classes, always log stack traces, and handle all error cases. Throw errors to signal node/flow failure.
- **Comprehensive Testing:** Write and extend Jest tests for all custom nodes and flows.
  See the [Testing](#testing) section below.
- **Batch Nodes:** If you implement `executeItem`, you **must** also implement a dummy `execute` to satisfy the `BaseNode` (or `A2ABaseNode`) abstract method requirement:
  ```ts
  async execute() { throw new Error("Not used in batch node"); }
  ```
- **Action Routing:** For linear flows, always return `"default"` (or `null`) from `finalize`. For branching, return the action string matching your successor.
- **A2A Node Base Class:** Use `A2ABaseNode` (inheriting from `BaseNode`) for any node that needs to interact with the incoming A2A message structure or define the outgoing A2A response message.
- **A2A Input Access:** Use `A2ABaseNode`'s protected helper methods (`getIncomingMessage`, `getIncomingParts`, `getIncomingDataPart`, `getIncomingData`) to access the structured incoming A2A message and its parts from the `shared` state.
- **A2A Output Setting:** Use `A2ABaseNode`'s protected helper methods (`setFinalResponseParts`, `setFinalResponseData`) to define the content (`Part[]`) of the final message returned in a synchronous (`tasks/send`) A2A response.
- **A2A Artifact Emission:** Use `A2ABaseNode`'s protected helper method `emitArtifact` to stream artifacts during execution in streaming (`tasks/sendSubscribe`) flows.
- **Multi-turn:** `shared.__a2a_history` contains the conversation history. Return `"input-required"` from `finalize` to pause the flow and wait for the next user message (via `tasks/send` with the same taskId).

---

## Overview

PocketMesh is a modern, type-safe, agentic workflow framework for TypeScript.
With **native A2A protocol support**, PocketMesh can expose its flows as open, discoverable agentic APIs (`tasks/send`, `tasks/sendSubscribe`, `tasks/get`) and interoperate with other A2A-compliant agents.

PocketMesh is modular, robust, and designed for reliability and extensibility. It features strict type safety, runtime validation, dependency injection for persistence and protocol layers, and comprehensive error handling and logging.

This guide covers **agentic coding best practices** and how to leverage A2A for multi-agent, multi-framework workflows, with details matching the v2.0 implementation.

---

## Agentic Coding Steps (PocketMesh + A2A v2.0)

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
- **A2A Use Cases (v2.0):**
  - Expose your agent’s skills using standard A2A `tasks/*` methods (A2A server).
  - Compose multi-agent workflows by calling other A2A agents (A2A client).
  - Interoperate with other frameworks (Google, OpenAI, CrewAI, LangGraph, etc.) that support A2A.

---

### 2. **Flow Design**

- **Outline your agentic workflow** using PocketMesh’s modular node/flow abstractions.
- **For A2A (v2.0):**
  - Each skill you want to expose must be a PocketMesh flow.
  - Each skill must be described in your AgentCard and registered in the `flows` map, keyed by skillId.
- **Design for multi-turn:**
  - If your agent requires user input mid-task, design nodes to return `"input-required"` and handle subsequent A2A messages with the same `taskId`. The A2A server handler automatically manages history (`shared.__a2a_history`).

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
  - Use `createA2AClient(agentUrl)` to call remote A2A agents from within your nodes or other utilities.
  - The client supports `sendTask` (synchronous), `getTask`, and `sendSubscribe` (streaming/SSE).
  - Example:
    ```typescript
    // Import from dist path
    import { createA2AClient } from "pocketmesh/dist/a2a/client";
    import type { Message } from "pocketmesh/dist/a2a/types";

    const a2a = createA2AClient("https://other-agent.com/a2a");

    const inputMessage: Message = {
      role: "user",
      parts: [{ type: "text", text: "Input text" }]
      // Add data/file parts as required by the remote agent's skill
      // { type: "data", data: { config: "value" } }
    };

    const resp = await a2a.sendTask("client-task-abc", inputMessage, "remoteSkillId");
    // Handle response, checking resp.result.status.message.parts for text/data/file
    if (resp.result?.status?.message?.parts) {
        const dataPart = resp.result.status.message.parts.find(p => p.type === 'data');
        console.log("Remote agent data response:", dataPart?.data);
    }

    ```
- **A2A Server Utility:**
  - Use `a2aServerHandler({ flows, agentCard, persistence })` to expose your flows via a standard HTTP POST endpoint (`/a2a` by convention).
  - The `flows` object must map skill IDs (as in AgentCard) to their corresponding PocketMesh flow instances.
  - `agentCard` is required to describe your agent's capabilities.
  - `persistence` is optional (defaults to SQLite).

---

### 4. **Node Design**

- **Base Class Selection (v2.0):**
  - Nodes that handle A2A *input messages* (accessing parts) or set A2A *output messages* (for `tasks/send` responses) **must** inherit from `A2ABaseNode`.
  - Nodes that only perform internal computation or call *out* to other services/agents without needing specific incoming message parsing or outgoing message formatting helpers can inherit from `BaseNode`.
- **Shared State:**
  - Use `SharedState` (a strongly-typed object) to persist all relevant data throughout the flow run.
  - **A2A Integration (v2.0):** The A2A server handler automatically populates A2A-specific information into `shared` state before running a node's lifecycle methods:
      - `shared.__a2a_history`: The full array of messages in the conversation for this task.
      - `shared.__a2a_incoming_message`: The specific `Message` object from the current client request.
      - `shared.__a2a_final_response_parts`: An array where `A2ABaseNode` nodes can store the `Part[]` array for the final `tasks/send` response message.
  - **Accessing A2A Data in Nodes (v2.0):** Use the protected helper methods on `A2ABaseNode` to access the incoming message and its parts safely (`this.getIncomingMessage(shared)`, `this.getIncomingData(shared)`, etc.).
  - **Setting A2A Output in Nodes (v2.0):** Use the protected helper methods on `A2ABaseNode` (`this.setFinalResponseParts(shared, parts)`, `this.setFinalResponseData(shared, data)`) to define the content of the message returned in the `tasks/send` response.
- **Parameters:**
  - Use `Params` for node/flow configuration and runtime overrides that *don't* come directly from the A2A message body (e.g., model names, API keys, flags).
- **Multi-turn:**
  - `shared.__a2a_history` is your source of truth for message history.
  - If your flow needs more input from the user, return `"input-required"` from `finalize`. The flow will pause, and the server will await a new `tasks/send` request with the same `taskId`.

---

### 5. **Implementation**

#### **A2A Server (Expose Flows as Skills - v2.0)**

1.  **Define your skills as flows, using `A2ABaseNode` where A2A I/O is needed:**
    ```typescript
    // Import from dist path
    import { Flow, BaseNode, SharedState } from "pocketmesh";
    import { A2ABaseNode } from "pocketmesh/dist/a2a/A2ABaseNode";
    import type { Message, Part } from "pocketmesh/dist/a2a/types";

    // Define shared state including A2A properties expected by A2ABaseNode
    interface MySkillSharedState extends SharedState {
       // Add your skill-specific properties here
       processedData?: any;

       // A2A Server Handler populates these:
       __a2a_history?: Message[];
       __a2a_incoming_message?: Message;
       __a2a_final_response_parts?: Part[];
    }

    class MySkillNode extends A2ABaseNode<MySkillSharedState> {
      async prepare(shared: MySkillSharedState): Promise<any> {
        // Use A2ABaseNode helpers to access incoming message parts
        const incomingText = this.getIncomingParts(shared).find(p => p.type === 'text')?.text;
        const incomingData = this.getIncomingData(shared); // From first data part

        console.log("Incoming text:", incomingText);
        console.log("Incoming data:", incomingData);

        // Prepare data for execute based on inputs
        return { text: incomingText, data: incomingData };
      }

      async execute(prep: { text?: string, data?: any }): Promise<any> {
        // Your core logic using prep data
        const result = { status: "done", processed: prep.text?.length };

        // Use A2ABaseNode helper to emit an artifact (for streaming clients)
        const artifactParts: Part[] = [this.createDataPart({ intermediateResult: result })];
        this.emitArtifact({ name: "intermediate", parts: artifactParts });

        return result; // Result passed to finalize
      }

      async finalize(shared: MySkillSharedState, _prep, execResult: any): Promise<string> {
        // Use A2ABaseNode helpers to set the final response message parts (for tasks/send clients)
        const finalParts: Part[] = [
          this.createTextPart(`Processing complete.`),
          this.createDataPart(execResult) // Include execution result in data part
        ];
        this.setFinalResponseParts(shared, finalParts);

        // Or just set a simple data response:
        // this.setFinalResponseData(shared, { finalStatus: "ok", data: execResult });

        return "default"; // Signal end of node/flow
      }
    }
    const mySkillFlow = new Flow(new MySkillNode());
    ```

2.  **Describe your skills in an AgentCard:**
    ```typescript
    // Import from dist path
    import { generateAgentCard } from "pocketmesh/dist/a2a/agentCard";

    const agentCard = generateAgentCard({
      name: "My Agent",
      url: "https://myagent.com/a2a",
      version: "2.0.0",
      description: "My awesome agent built with PocketMesh v2.0",
      skills: [
        {
          id: "my-skill",
          name: "My Skill",
          description: "Processes text and data input, returns data.",
          inputModes: ["text", "json"], // Declare accepted input types
          outputModes: ["text", "json"], // Declare produced output types
        }
      ],
      capabilities: { streaming: true, pushNotifications: false } // Declare capabilities
    });
    ```

3.  **Expose your agent via HTTP (with pluggable persistence):**
    ```typescript
    import express from "express";
    // Import from dist path
    import { a2aServerHandler } from "pocketmesh/dist/a2a/server";
    // Import Persistence interface if injecting custom persistence
    import type { Persistence } from "pocketmesh/dist/utils/persistence";

    // Assuming mySkillFlow and agentCard are defined
    // Assuming myCustomPersistence implements Persistence interface (optional)

    const app = express();
    app.use(express.json()); // Middleware to parse JSON body

    // Serve agent card at the well-known location
    app.get("/.well-known/agent.json", (_req, res) => res.json(agentCard));

    // Handle all A2A JSON-RPC requests (tasks/send, tasks/sendSubscribe, tasks/get etc.)
    app.post("/a2a", a2aServerHandler({
      flows: { "my-skill": mySkillFlow }, // Map skill IDs to Flow instances
      agentCard, // Provide your agent card
      // persistence: myCustomPersistence, // <-- Optional: inject your own persistence implementation
    }));

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`A2A Agent running on http://localhost:${PORT}`);
    });
    ```
    - The `flows` map **must** use skill IDs as keys, matching those in the AgentCard.
    - The `persistence` option is **optional**; if omitted, the built-in SQLite database (`pocketmesh.sqlite` in the working directory) is used by default.

#### **A2A Client (Call Other Agents as Nodes - v2.0)**

- **Call remote A2A agents from a node:**
    ```typescript
    import { BaseNode, SharedState } from "pocketmesh"; // Use BaseNode if not an A2A endpoint node
    // Import from dist paths
    import { createA2AClient } from "pocketmesh/dist/a2a/client";
    import type { Message, SendTaskResponse } from "pocketmesh/dist/a2a/types";
    import { isDataPart, isTextPart } from "pocketmesh/dist/a2a/types"; // Type guards

    class CallOtherAgentNode extends BaseNode<SharedState> {
      async execute(_prep: any, params: any): Promise<any> {
        const remoteAgentUrl = params.remoteAgentUrl as string; // Get URL from params or config
        const client = createA2AClient(remoteAgentUrl);

        // Generate a unique task ID for this specific interaction with the remote agent
        const remoteTaskId = `remote-call-${Date.now()}`;

        // Prepare the message for the remote agent. Format based on its skill's inputModes.
        const messageToSend: Message = {
          role: "user", // The role of the sender (you, acting as a user to the remote agent)
          parts: [
            { type: "text", text: params.input as string }, // Send text input
            // Add other parts like 'data' or 'file' if required by the remote skill
            // this.createDataPart({ someConfig: "value" }) // Requires extending A2ABaseNode for helpers
            // Or manually create parts: { type: "data", data: { someConfig: "value" } }
          ]
        };

        console.log(`Calling remote agent at ${remoteAgentUrl} with task ${remoteTaskId}`);

        // Call the remote agent using tasks/send (synchronous)
        const response: SendTaskResponse = await client.sendTask(
          remoteTaskId,
          messageToSend,
          params.remoteSkillId as string // The skill ID the remote agent understands
        );

        console.log("Remote agent response:", JSON.stringify(response, null, 2));

        // --- v2.0.0: Extract response from the agent's message parts ---
        const remoteAgentMessage = response.result?.status?.message;
        const extractedResults: any = {};

        if (remoteAgentMessage?.parts) {
            console.log("Remote agent response message parts:", remoteAgentMessage.parts);
            // Extract text parts
            const textParts = remoteAgentMessage.parts.filter(isTextPart).map(p => p.text);
            if (textParts.length > 0) extractedResults.textResult = textParts.join('\n');

            // Extract data parts
            const dataParts = remoteAgentMessage.parts.filter(isDataPart).map(p => p.data);
             // You might want to merge data parts or handle them individually
            if (dataParts.length > 0) extractedResults.dataResults = dataParts;

            // Extract file parts if expected
            // const fileParts = remoteAgentMessage.parts.filter(isFilePart);
            // if (fileParts.length > 0) extractedResults.fileResults = fileParts;

        } else {
            console.warn("Remote agent response message or parts missing/malformed:", response);
             // Handle error response from remote agent
            if (response.error) {
                extractedResults.error = response.error;
            } else {
                 extractedResults.error = { code: -32006, message: "Invalid remote agent response structure" };
            }
        }
        // --- End v2.0.0 change ---

        return extractedResults; // Return the extracted results for finalize
      }

      async finalize(shared: SharedState, _prep: any, execResult: any): Promise<string> {
        // Store the extracted results from the remote call in shared state
        shared.remoteCallResults = execResult;
        console.log("Stored remote call results in shared state.");
        return "default"; // Continue flow
      }
    }
    ```
    *Note: If `CallOtherAgentNode` also needs to act as an A2A agent endpoint (e.g., is part of a flow used by `a2aServerHandler`), it should extend `A2ABaseNode` and use its helpers for *its own* inputs/outputs.*

#### **Artifact Emission (v2.0)**

- To emit an artifact (file, data, etc.) from a node, use the `emitArtifact` protected helper method on `A2ABaseNode`. This is the preferred way in v2.0+. The A2A server handler listens for these calls during `tasks/sendSubscribe` requests and sends them as `TaskArtifactUpdateEvent`s.
  ```typescript
  // Assume MyNode extends A2ABaseNode
  import { A2ABaseNode } from "pocketmesh/dist/a2a/A2ABaseNode";
  import type { Part } from "pocketmesh/dist/a2a/types";

  class MyArtifactEmittingNode extends A2ABaseNode {
    async execute(prep: any, params: any): Promise<any> {
      // ... your logic ... generates some data or file

      const intermediateData = { progress: "50%", value: Math.random() };
      const generatedReportText = "This is the report content.";
      const base64Image = "iVBORw0KGgo..."; // Example base64

      // Use A2ABaseNode helpers to create Part objects
      const dataPart = this.createDataPart(intermediateData);
      const textPart = this.createTextPart(generatedReportText);
      const filePart = this.createFilePart({
          name: "chart.png",
          mimeType: "image/png",
          bytes: base64Image
      });


      // Use A2ABaseNode helper to emit artifacts
      this.emitArtifact({
        name: "intermediate_data",
        description: "Structured data update",
        parts: [dataPart] // Artifacts contain arrays of parts
      });

      this.emitArtifact({
         name: "progress_report",
         description: "Human-readable progress",
         parts: [textPart, filePart] // An artifact can have multiple parts
      });

      // Return main execution result (optional, distinct from artifacts)
      return { status: "Execution continuing..." };
    }

     async finalize(shared: SharedState, _prep, execResult): Promise<string> {
        // For streaming, setting final response parts might be less critical
        // as the stream events are the primary output. But you could set a final
        // status message here if needed.
        // this.setFinalResponseParts(shared, [this.createTextPart("Processing finished.")]);
        return "default";
     }
  }
  ```

---

#### **Persistence and Multi-turn (v2.0)**

- **PocketMesh’s A2A server implementation persists all task state, history, and artifacts in SQLite (`pocketmesh.sqlite`) by default.** This includes the `SharedState` object for every step.
- **A2A `taskId` is mapped to a persistent `runId` internally.**
- **Multi-turn (input-required):**
  - If your flow needs more input, a node should return `"input-required"` in its `finalize` method.
  - The A2A server will return a `TaskStatus` with `state: "input-required"` and pause the run.
  - When the client sends a follow-up `tasks/send` request with the *same* `taskId`, the server resumes the flow, updates `shared.__a2a_incoming_message` and `shared.__a2a_history`, and continues execution from the node *after* the one that returned `"input-required"`.
- **Custom Persistence (Pluggable):**
  - You can inject your own persistence layer by providing a custom implementation of the `Persistence` interface to `a2aServerHandler` or `FlowStepper`.

---

### Pluggable Persistence Layer (v2.0)

PocketMesh allows you to use your own persistence backend by implementing the `Persistence` interface.

**Example: Using a custom persistence with `a2aServerHandler`**

```typescript
// Import from dist path
import { a2aServerHandler } from "pocketmesh/dist/a2a/server";
import type { Persistence } from "pocketmesh/dist/utils/persistence";

// Assuming flows and agentCard are defined
// Assuming myCustomPersistence implements Persistence interface

app.post("/a2a", a2aServerHandler({
  flows,
  agentCard,
  persistence: myCustomPersistence, // <-- inject your own
}));
```

**Example: Using a custom persistence with `FlowStepper`**

```typescript
// Import from dist path
import { FlowStepper } from "pocketmesh/dist/stepper";
import type { Persistence } from "pocketmesh/dist/utils/persistence";

// Assuming createMyFlow is a function that returns a Flow
// Assuming myCustomPersistence implements Persistence interface

const stepper = new FlowStepper(
  {
    flowName: "my-flow",
    flowFactory: createMyFlow,
    persistence: myCustomPersistence, // <-- inject your own
  },
  initialSharedState,
  params
);
```

If you do not provide a `persistence` option, PocketMesh will use the built-in SQLite backend (`pocketmesh.sqlite`) by default.

---

### 6. **Optimization**

- **Prompt Engineering:**
  - Use clear, structured prompts for LLM nodes.
- **Skill/Flow Modularity:**
  - Compose complex agents by chaining A2A skills (local or remote).
- **Streaming:**
  - For long-running tasks, implement streaming via `tasks/sendSubscribe` and SSE.
  - Use the production-quality streaming client pattern (see below).
  - Use `emitArtifact` in `execute` or `executeItem` to send incremental results.

---

### 7. **Reliability**

- **Retries and Fallbacks:**
  - Use `.setOptions({ maxRetries, waitSeconds, parallel })` on `BaseNode` or `A2ABaseNode` instances.
  - Implement `executeFallback` or `executeItemFallback` methods.
- **Logging:**
  - PocketMesh provides built-in logging for node execution, retries, and errors via `pocketmesh/dist/utils/logger`.
- **A2A Protocol Compliance:**
  - All A2A requests (`tasks/send`, `tasks/sendSubscribe`, `tasks/get`, etc.) are handled according to the defined protocol structure (schema compliance for payloads).
  - Incoming A2A requests are validated at runtime using [zod](https://zod.dev/). Invalid requests receive appropriate JSON-RPC errors.
  - Task state is persisted and recoverable via `tasks/get`.
- **Error Handling:**
  - Uncaught errors during node execution are caught by the A2A server handler, logged, and returned to the client as a JSON-RPC error object (`-32603 Internal error` or specific A2A errors like `-32001 Task not found`).
  - Implement explicit `try...catch` in `execute` methods for fine-grained control or graceful error handling within the flow.

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
  For A2A nodes, test that inputs from shared state (`__a2a_incoming_message`) are handled correctly and that outputs (`__a2a_final_response_parts`, emitted artifacts) are set/emitted as expected.
- **AI agents:**
  When generating new nodes/flows, always generate or update tests to match.

---

## Example Project Structure (with A2A)

```filetree
my_project/
├── src/
│   ├── main.ts           # Express server setup, a2aServerHandler config
│   ├── nodes/            # Node class definitions (extend BaseNode or A2ABaseNode)
│   │   └── mySkillNode.ts
│   ├── flows.ts          # Flow creation logic (maps skill IDs to Flows)
│   ├── core/             # PocketMesh core (should not need modification)
│   │   ├── node.ts
│   │   ├── flow.ts
│   │   └── types.ts
│   ├── utils/            # PocketMesh utilities (can be extended or replaced)
│   │   ├── logger.ts
│   │   ├── retry.ts
│   │   └── persistence.ts # Default SQLite implementation
│   └── a2a/              # PocketMesh A2A integration (should not need modification)
│       ├── index.ts      # Barrel export for A2A components
│       ├── agentCard.ts  # AgentCard utilities
│       ├── client.ts     # A2A client implementation
│       ├── server.ts     # A2A server handler implementation (tasks/* methods, SSE)
│       ├── types.ts      # A2A protocol types (from schema)
│       ├── validation.ts # Zod validation schemas
│       └── A2ABaseNode.ts # Base class for A2A nodes
├── docs/
│   └── design.md         # High-level design document
├── package.json
├── tsconfig.json
└── pocketmesh.sqlite     # Persistent state (auto-created by default persistence)
```
*Note: The specific file paths within `src/a2a/` might vary slightly in the final package structure, but importing from `pocketmesh/dist/a2a` is the correct way.*

---

## Production-Quality Streaming Client Example (v2.0)

To receive real-time progress and artifact events from an A2A agent using `tasks/sendSubscribe`, use the `createA2AClient` and `sendSubscribe` methods with robust event and error handling.
**Requires [`undici`](https://www.npmjs.com/package/undici) for Node.js streaming fetch.**

```typescript
// Import from dist path
import { createA2AClient } from "pocketmesh/dist/a2a/client";
import type { Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "pocketmesh/dist/a2a/types";
import { isDataPart, isFilePart, isTextPart } from "pocketmesh/dist/a2a/types"; // Type guards for parts

// Create the client for the remote agent
const client = createA2AClient("http://localhost:4000/a2a"); // Replace with actual agent URL

const taskId = "my-streaming-task";
const message: Message = {
  role: "user",
  parts: [
    { type: "text", text: "Hello, stream this process!" },
    // Add data/file parts here if the skill requires structured input for streaming
    // { type: "data", data: { config: "streamingMode" } }
  ],
};

console.log(`Initiating streaming task ${taskId}...`);

// Wait for streaming to finish before continuing or exiting
await new Promise<void>((resolve, reject) => {
  const close = client.sendSubscribe(
    taskId, // Use a unique taskId for the task
    message, // Initial message
    "skillId", // Optional skill ID
    (event) => {
      // Handle each streaming event (TaskStatusUpdateEvent or TaskArtifactUpdateEvent)
      console.log("\n--- STREAM EVENT RECEIVED ---");
      console.log(JSON.stringify(event, null, 2));

      if ("status" in event) {
        console.log("Event Type: Status Update");
        console.log(`Status: ${event.status.state}`);
        if (event.status.message?.parts) {
            // Check for structured message parts in status updates (v2.0+)
            event.status.message.parts.forEach(part => {
                if (isTextPart(part)) console.log("  Status Text:", part.text);
                if (isDataPart(part)) console.log("  Status Data:", part.data);
                 // Handle FileParts in status messages if applicable
            });
        }

        // The 'final' flag or 'completed'/'failed' state indicates the end of the stream
        if (event.final || event.status.state === "completed" || event.status.state === "failed") {
          console.log(`Stream finished with state: ${event.status.state}`);
          close(); // Close the SSE connection
          // Use a small timeout to ensure console output flushes before resolving/exiting
          setTimeout(resolve, 100);
        }
      } else if ("artifact" in event) {
        console.log("Event Type: Artifact Update");
        console.log(`Artifact: ${event.artifact.name || 'Unnamed Artifact'}`);
        if (event.artifact.parts) {
             // Check for structured message parts within the artifact (v2.0+)
             event.artifact.parts.forEach(part => {
                 if (isTextPart(part)) console.log("  Artifact Text:", part.text);
                 if (isDataPart(part)) console.log("  Artifact Data:", part.data);
                 if (isFilePart(part)) {
                     console.log("  Artifact File:", {
                         name: part.file.name,
                         mimeType: part.file.mimeType,
                         // Avoid logging large byte strings or URIs unless specifically debugging
                         hasBytes: !!part.file.bytes,
                         hasUri: !!part.file.uri
                     });
                     // If you need to process file bytes/uri, do it here.
                     // Example for bytes: Buffer.from(part.file.bytes, 'base64').toString();
                 }
             });
        }
      }
    },
    (err) => {
      // Only log real errors (AbortError is suppressed in client)
      console.error("\n--- STREAM ERROR ---", err);
      reject(err); // Reject the promise on error
    }
  );
});
console.log("\nStreaming process concluded.");
```

**Notes:**
- The `sendSubscribe` method initiates a `tasks/sendSubscribe` JSON-RPC call and processes the Server-Sent Events (SSE) response stream.
- The callback receives each `TaskStatusUpdateEvent` or `TaskArtifactUpdateEvent` as soon as it is emitted by the server.
- In v2.0, status updates and artifacts can contain `data` or `file` parts, which you should check for in your client handling logic.
- The returned `close` function aborts the stream.
- The client suppresses the expected `AbortError` on normal close.
- You must `npm install undici` for Node.js streaming support.
- Nodes emit progress events via `this.flow?.onStatusUpdate` (resulting in `TaskStatusUpdateEvent`) and artifact events via `this.emitArtifact` (resulting in `TaskArtifactUpdateEvent`) as the flow progresses.

---

## A2A Integration: Quick Reference (v2.0)

- **Expose flows as A2A skills:**
  - Nodes in these flows should inherit from `A2ABaseNode` if they handle structured A2A I/O.
  - Register each skill as a flow in the `flows` map for `a2aServerHandler`, keyed by skillId.
  - Describe each skill (input/output modes, capabilities) in your AgentCard.
  - PocketMesh handles standard A2A methods: `tasks/send` (synchronous), `tasks/sendSubscribe` (streaming via SSE), `tasks/get` (status/history).
- **Call remote A2A agents:**
  - Use `createA2AClient(agentUrl)` in any node (typically `BaseNode`) or utility.
- **A2A Input in Nodes:**
  - Use `this.getIncomingMessage(shared)`, `this.getIncomingParts(shared)`, `this.getIncomingDataPart(shared)`, `this.getIncomingData(shared)` (available on `A2ABaseNode`).
  - Server handler populates `shared.__a2a_incoming_message` and `shared.__a2a_history`.
- **A2A Output from Nodes (`tasks/send` Response):**
  - Use `this.setFinalResponseParts(shared, parts)` or `this.setFinalResponseData(shared, data)` in `finalize` (available on `A2ABaseNode`).
  - Server handler uses `shared.__a2a_final_response_parts` for the final response message in `tasks/send`.
- **A2A Output from Nodes (Streaming Artifacts):**
  - Use `this.emitArtifact(artifact)` in `execute` or `executeItem` (available on `A2ABaseNode`).
  - Server handler emits `TaskArtifactUpdateEvent`s for these during `tasks/sendSubscribe`.
- **Persistence:**
  - All A2A tasks, runs, message history (`shared.__a2a_history`), and step state (`shared`) are persisted in SQLite (`pocketmesh.sqlite`) by default.
  - You can inject a custom `Persistence` implementation.
- **Multi-turn:**
  - Use the same taskId for follow-up `tasks/send` messages.
  - Return `"input-required"` from `finalize` to request more input.
- **Error Handling:**
  - Runtime validation of incoming requests.
  - Catch errors in nodes, or rely on the server handler to return JSON-RPC errors.

---

## Implementation Notes and Clarifications (v2.0)

- **A2ABaseNode vs. BaseNode:** Nodes that are the *entry point* or steps within a flow called by `a2aServerHandler` should typically inherit from `A2ABaseNode` if they need access to the incoming A2A message structure or need to set the final A2A response structure. Nodes that are purely internal helpers or only call *out* can use `BaseNode`.
- **Import Paths:** For A2A-specific components (`A2ABaseNode`, A2A types, `a2aServerHandler`, `createA2AClient`), always import from the `pocketmesh/dist/a2a` or `pocketmesh/dist/a2a/client` etc. distribution paths. Core components (`Flow`, `BaseNode`, `SharedState`, `Params`) are from the main `pocketmesh` package.
- **Incoming Message (`shared.__a2a_incoming_message`):** The A2A server handler populates this property on the `shared` state object for *each* incoming `tasks/send` or `tasks/sendSubscribe` request that triggers a flow run or resumption. It represents the `message` parameter from the current request. Nodes access this via `A2ABaseNode` helpers.
- **Final Response Parts (`shared.__a2a_final_response_parts`):** `A2ABaseNode` nodes use helpers like `setFinalResponseParts` to set this property on the `shared` state object. After the flow completes a `tasks/send` request, the A2A server handler checks this property. If it contains a `Part[]` array, this array is used as the `parts` for the `message` object within the `result.status` of the final `tasks/send` JSON-RPC response. If this property is not set, the server may fall back to using `shared.lastEcho` (if set) for a simple text response, but setting `__a2a_final_response_parts` is the standard v2.0 way for structured responses.
- **Artifacts:** Emitting artifacts via `this.emitArtifact()` is the standard way to send incremental results during processing, particularly useful for streaming flows (`tasks/sendSubscribe`).
- **Persistent History (`shared.__a2a_history`):** This property is an array of all `Message` objects exchanged for a given task ID (`tasks/send` or `tasks/sendSubscribe` calls related to the same ID). The A2A server handler maintains this automatically across turns and persists it. Nodes can access this directly from the `shared` object for conversational context.
- **`shared.input`:** This property is still set by the A2A server handler for backward compatibility, containing the text content of the *first* text part in the incoming message. However, using `A2ABaseNode` helpers like `getIncomingParts(shared)` and `getIncomingData(shared)` provides access to *all* parts and is the recommended v2.0 approach for robust input handling.
- **Push Notifications:** The A2A protocol defines mechanisms for push notifications, but the built-in `a2aServerHandler` currently focuses on the request/response (`tasks/send`) and streaming (`tasks/sendSubscribe`) patterns. Implementing out-of-band push notifications requires custom server logic.
- **Error Handling:** Use `try...catch` in `execute` methods to handle expected errors gracefully within the flow. Throwing an error from any lifecycle method will typically halt the flow and result in a JSON-RPC error response from the A2A server handler.

---

## Further Reading

- [A2A Protocol Spec](https://google.github.io/A2A/)
- [PocketMesh Documentation](https://github.com/the-pocket/pocketmesh) <!-- TODO: update to PocketMesh repo when available -->
- [PocketMesh Example Flows](./src/demo/)
- [PocketMesh A2A Demo](./src/demo/a2a/index.ts)

---

## Common Pitfalls (v2.0)

- **Incorrect Imports:**
  Don’t import A2A components from the main `pocketmesh` package or deep `src/` paths. Use the specified `pocketmesh/dist/a2a` paths.
- **Using `BaseNode` instead of `A2ABaseNode`:**
  If your node needs to access incoming A2A message *parts* (beyond simple `shared.input`) or set the final A2A *response parts*, it MUST extend `A2ABaseNode` to use the necessary helpers.
- **Accessing A2A Input Manually:**
  Avoid manually inspecting `shared.__a2a_history` for the *current* turn's message parts. Use `A2ABaseNode` helpers like `getIncomingParts(shared)` or `getIncomingData(shared)`. Access `shared.__a2a_history` only when you need the *full* conversation history.
- **Setting A2A Output Manually:**
  For synchronous `tasks/send` responses, avoid setting `shared.lastEcho` for structured output. Use `A2ABaseNode` helpers like `setFinalResponseParts(shared, parts)` or `setFinalResponseData(shared, data)` instead.
- **Batch Node Dummy Execute Error:**
  If you implement `executeItem`, you **must** also implement a dummy `execute` method on your node.
- **Action Mismatch:**
  If your `finalize` returns `"done"` but your successor is `"default"`, the flow will halt. Match action strings!
- **Missing Tests:**
  Don’t skip tests. Every node and flow should have a corresponding Jest test.
- **Misunderstanding Multi-turn:**
  Return `"input-required"` to pause and wait for user input. The server handles resuming the flow on the next request with the same `taskId`.

---

## AI Coding Tips (v2.0)

- **A2ABaseNode First for A2A:**
  When creating a node for an A2A flow, default to extending `A2ABaseNode`.
- **Helper Usage:**
  Leverage `A2ABaseNode` helper methods (`getIncoming*`, `setFinalResponse*`, `emitArtifact`, `create*Part`) for all A2A message interactions. This is the standard pattern and improves type safety.
- **Docstrings & Types:**
  Add docstrings to every class and method. Use TypeScript generics and specific shared state interfaces (e.g., `MySkillSharedState extends SharedState`).
- **Composable Patterns:**
  Favor composition (connecting nodes/flows) over inheritance for extensibility.
- **Testing First:**
  Generate tests alongside new code. Use the test suite as a spec for AI-driven refactoring. Test that your A2A nodes correctly use the `A2ABaseNode` helpers for I/O.
- **Error Context:**
  Always include context in error messages for easier debugging and AI troubleshooting.

---

**Agentic Coding = Human Design + Agent Implementation + Open Protocols (A2A)!**
---
