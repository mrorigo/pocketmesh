# PocketMesh A2A Streaming & Artifact Events

## How to Emit Progress and Artifacts from Nodes

PocketMesh's Flow now supports real-time streaming of progress and artifacts via the A2A protocol.

### Progress Events

- The `onStatusUpdate` hook is called at each node/step and for each batch item.
- You can customize node classes to emit custom progress messages by calling `this.flow?.onStatusUpdate?.({ ... })` if you want fine-grained control.

### Artifact Events

- To emit an artifact (file, data, etc.) from a node, call the protected helper `this.emitArtifact({ ... })` from within an `A2ABaseNode`:
    ```typescript
    this.emitArtifact({
      artifactId: uuidv4(),
      name: "output.txt",
      parts: [{ kind: "text", text: "Artifact content" }]
    });
    ```
- The A2A server publishes a `TaskArtifactUpdateEvent` for every artifact emitted during execution.

### Example: Streaming SSE from the Server

- The A2A server emits `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` as the flow progresses.
- The client receives these events in real time via `sendSubscribe`.

### Example: Client Usage

```typescript
const client = await createA2AClient("http://localhost:4000");

for await (const event of client.sendMessageStream({
  message: {
    kind: "message",
    messageId: uuidv4(),
    taskId: "task-123",
    contextId: uuidv4(),
    role: "user",
    metadata: { skillId: "echo" },
    parts: [{ kind: "text", text: "Hello!" }]
  },
  configuration: { blocking: false }
})) {
  console.log("Stream event:", event);
}
```
