## PocketMesh v0.2.0 Migration Guide

This guide outlines the necessary steps to migrate your existing PocketMesh projects, particularly those implementing A2A agents, from versions 0.1.x to v0.2.0.

### Introduction

Version 0.2.0 introduces a significant breaking change to how PocketMesh nodes interact with the A2A protocol layer when acting as an agent server. This change standardizes the way nodes access incoming A2A message data and define the outgoing A2A response message, leading to cleaner and more robust A2A agent implementations.

The core of this change is the introduction of `A2ABaseNode`, a new base class for nodes specifically designed to operate within an A2A server context.

### Key Breaking Change: A2A Node Implementation

Prior to v0.2.0, A2A nodes typically accessed incoming message data (beyond simple text) by manually inspecting `shared.__a2a_history` and extracting parts from the latest message. Outgoing messages, especially structured ones, were less standardized, sometimes relying on `shared.lastEcho` for text or returning special properties like `__a2a_artifact` for streaming.

In v0.2.0, A2A nodes should now inherit from `A2ABaseNode` and use its provided helper methods to interact with the A2A message structure:

1.  **Input Access:** Instead of directly accessing `shared.__a2a_history` or `shared.input`, use `A2ABaseNode`'s protected methods like `getIncomingMessage(shared)`, `getIncomingParts(shared)`, `getIncomingDataPart(shared)`, and `getIncomingData(shared)`. These methods provide type-safe access to the incoming message and its various parts. The `shared` state object is passed to these methods as an argument.
2.  **Synchronous Output (`tasks/send`):** Instead of setting `shared.lastEcho` for the final response text, use `A2ABaseNode`'s protected methods like `setFinalResponseParts(shared, parts)` or `setFinalResponseData(shared, data)` to define the complete array of `Part` objects for the final A2A response message. The A2A server handler will use this array (`shared.__a2a_final_response_parts`) to construct the `result` message in the `tasks/send` response.
3.  **Streaming Output (`tasks/sendSubscribe`):** Emitting artifacts during streaming should now be done using the `A2ABaseNode` helper `emitArtifact(artifact)`. This method wraps the existing `this.flow?.onArtifact` hook. Status updates still use `this.flow?.onStatusUpdate`.

Nodes that do *not* participate in A2A interactions (i.e., are not part of a flow registered with `a2aServerHandler`) should continue to inherit from `BaseNode`.

### Migration Steps

Follow these steps to update your PocketMesh A2A agent code:

1.  **Update PocketMesh Dependency:**
    Update your `package.json` to use the new major version:
    ```bash
    npm install pocketmesh@^0.2.0
    # or
    yarn add pocketmesh@^0.2.0
    ```

2.  **Identify A2A Nodes:**
    Determine which of your `BaseNode` implementations are part of flows that are passed to `a2aServerHandler`. These are the nodes that need modification.

3.  **Change Node Inheritance:**
    For each identified A2A node class, change its base class from `BaseNode` to `A2ABaseNode`.
    *   **Old:**
        ```typescript
        import { BaseNode, SharedState, Params, ActionResult } from "pocketmesh";

        class MyA2ANode extends BaseNode<SharedState> {
          // ...
        }
        ```
    *   **New:**
        ```typescript
        // Update the import path for A2ABaseNode
        import { A2ABaseNode, SharedState, Params, ActionResult } from "pocketmesh/dist/a2a";
        // You might also need to import A2A types like Message, Part, isDataPart etc.
        import type { Message, Part } from "pocketmesh/dist/a2a";
        import { isDataPart } from "pocketmesh/dist/a2a";

        class MyA2ANode extends A2ABaseNode<SharedState> {
          // ...
        }
        ```
    *   *Note:* While core types (`SharedState`, `Params`, etc.) are usually available directly from `"pocketmesh"`, A2A-specific types and `A2ABaseNode` might require importing from the `dist/a2a` path depending on how your build is configured and how the library is packaged. `pocketmesh/dist/a2a` is the likely standard import path.

4.  **Update Input Access Logic:**
    Refactor the parts of your node's `prepare` or `execute` methods where you previously manually extracted data from `shared.__a2a_history`. Use the new `getIncoming*` helper methods, remembering to pass the `shared` state object.
    *   **Old (Example):**
        ```typescript
        async prepare(shared: SharedState, params: Params): Promise<string> {
          // Manual history access (less type-safe)
          const history = (shared.__a2a_history as Message[]) || [];
          const latestUserMessage = history.find(m => m.role === "user");
          const input = latestUserMessage?.parts.find(p => p.type === "text")?.text || "";
          return input;
        }
        ```
    *   **New (Example using `A2ABaseNode`):**
        ```typescript
        // MyA2ANode extends A2ABaseNode
        async prepare(shared: SharedState, params: Params): Promise<string> {
          // Use helper to get text input
          const input = this.getIncomingParts(shared).find(p => p.type === "text")?.text || "";

          // Use helper to get structured data input (e.g., an AgentCard)
          const agentCardData = this.getIncomingData(shared);
          if (!agentCardData) {
             // Handle missing or invalid data input
             throw new Error("Expected structured data input.");
          }
          const agentCard = agentCardData as { name: string, url: string /* etc. */ }; // Cast as appropriate

          return input; // Or return agentCard, or whatever is needed for execute
        }
        ```

5.  **Update Synchronous Output Logic (`tasks/send`):**
    Refactor the parts of your node's `finalize` method (or `execute` if it returns the final payload) where you set the output for the final response message. Use the new `setFinalResponseParts` or `setFinalResponseData` methods. This replaces the old `shared.lastEcho` approach for defining the *content* of the agent's final response message.
    *   **Old (Example - text only):**
        ```typescript
        async finalize(shared: SharedState, ...): Promise<ActionResult> {
          shared.lastEcho = "Operation successful."; // Sets text response
          return "default";
        }
        ```
    *   **New (Example using `A2ABaseNode` - text and data):**
        ```typescript
        // MyA2ANode extends A2ABaseNode
        async finalize(shared: SharedState, _prep, execResult: any, _params): Promise<ActionResult> {
          // Assume execResult has some structured data, e.g., { status: "ok" }
          const resultData = { status: "ok", ...execResult };

          // Use helpers to set the final response message parts
          this.setFinalResponseParts(shared, [
             this.createTextPart("Operation completed successfully."), // Add a text part
             this.createDataPart(resultData) // Add a data part
          ]);

          // Alternative for just data:
          // this.setFinalResponseData(shared, resultData);

          return "default";
        }
        ```

6.  **Update Streaming Artifact Emission:**
    If your node previously emitted artifacts for streaming clients using `this.flow?.onArtifact` or by returning an object with `__a2a_artifact` from `execute`/`executeItem`, update this to use the `emitArtifact` helper on `A2ABaseNode`. The core mechanism remains the same, but the helper provides a standard way to access it.
    *   **Old (Example):**
        ```typescript
        async execute(...): Promise<any> {
          const artifactData = { ... };
          if (this.flow?.onArtifact) {
             this.flow.onArtifact(artifactData); // Direct hook call
          }
          return { result: "...", __a2a_artifact: artifactData }; // Special return prop
        }
        ```
    *   **New (Example using `A2ABaseNode`):**
        ```typescript
        // MyA2ABaseNode extends A2ABaseNode
        async execute(...): Promise<any> {
          const artifactData = { name: "output.json", parts: [ this.createDataPart({ ... }) ] };
          this.emitArtifact(artifactData); // Use helper

          // If returning from execute, the A2A server handler should still pick up __a2a_artifact
          // for streaming, but using emitArtifact during execution is generally preferred.
          // The special return value might be deprecated in the future, rely on emitArtifact.
          return { result: "Operation progressing..." };
        }
        ```

7.  **Review and Test:**
    Thoroughly test your A2A agent endpoints (`tasks/send`, `tasks/sendSubscribe`, `tasks/get`) with an A2A client (like the one provided in PocketMesh's demo or the registry). Ensure that:
    *   Inputs (text, data, file parts) are correctly parsed by your nodes.
    *   Outputs (text, data parts) for `tasks/send` responses are correctly formatted.
    *   Artifacts and status updates are streamed correctly for `tasks/sendSubscribe`.
    *   Task status and history are retrieved correctly via `tasks/get`.

### New Features and Improvements in v0.2.0 (A2A Context)

*   **Standardized Input Access:** The `getIncoming*` helpers provide a consistent and type-aware way to extract data from client messages.
*   **Structured Output Control:** `setFinalResponseParts` and `setFinalResponseData` give nodes precise control over the content and structure of the final `tasks/send` response message's parts.
*   **Cleaner Code:** Separating A2A concerns into `A2ABaseNode` improves the readability and maintainability of nodes that participate in A2A flows.
*   **Improved Type Safety:** Using the provided helpers reduces reliance on manual string indexing (`shared['__a2a_history']`) and allows for better type checking by TypeScript.

By following this guide, you can successfully migrate your PocketMesh A2A agent implementations to v0.2.0, leveraging the improved structure for handling A2A interactions.
