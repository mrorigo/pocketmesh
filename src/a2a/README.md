# PocketMesh A2A Streaming & Artifact Events

## How to Emit Progress and Artifacts from Nodes

PocketMesh's Flow now supports real-time streaming of progress and artifacts via the A2A protocol.

### Progress Events

- The `onStatusUpdate` hook is called at each node/step and for each batch item.
- You can customize node classes to emit custom progress messages by calling `this.flow?.onStatusUpdate?.({ ... })` if you want fine-grained control.

### Artifact Events

- To emit an artifact (file, data, etc.) from a node, return an object with a `__a2a_artifact` property from your `execute` or `executeItem` method:
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
- The A2A server will emit a `TaskArtifactUpdateEvent` for each artifact.

### Example: Streaming SSE from the Server

- The A2A server emits `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` as the flow progresses.
- The client receives these events in real time via `sendSubscribe`.

### Example: Client Usage

```typescript
const client = createA2AClient("http://localhost:4000/a2a");
const close = client.sendSubscribe(
  "task-123",
  { role: "user", parts: [{ type: "text", text: "Hello!" }] },
  "echo",
  (event) => { console.log("SSE event:", event); }
);
// ... later: close();
```
