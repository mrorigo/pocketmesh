# Advanced Patterns in PocketMesh

This guide covers sophisticated techniques for building complex, production-ready agentic workflows with PocketMesh. It assumes familiarity with the basics from [Quickstart Flow](./quickstart-flow.md) and [A2A Agents](./a2a-agents.md). We'll explore multi-turn interactions, custom persistence, LLM integration, error resilience, and flow composition.

## 1. Multi-Turn Conversations

PocketMesh supports resumable, stateful interactions—ideal for conversational agents or iterative tasks. Use the built-in persistence to pause flows and resume on subsequent A2A messages.

### Key Concepts
- **Task Linking:** Each A2A `taskId` maps to a flow `runId` via `PocketMeshTaskStore`.
- **Pause/Resume:** Return `"input-required"` from `finalize` to pause. The next `message/send` with the same `taskId` resumes execution.
- **History:** Shared state includes `__a2a_history` (array of past messages) for context.

### Example: Conversational Greeting Agent

```ts
import { Flow, BaseNode, A2ABaseNode } from "pocketmesh";
import { randomUUID } from "crypto";

interface ConversationState {
  greeting?: string;
  userName?: string;
  __a2a_history?: Message[]; // Auto-populated
  __a2a_incoming_message?: Message;
}

class GreetNode extends A2ABaseNode<ConversationState> {
  async prepare(shared) {
    const history = shared.__a2a_history ?? [];
    const latestText = this.getIncomingParts(shared).find(isTextPart)?.text ?? "";
    if (history.length === 0) {
      shared.userName = latestText; // First message: extract name
      return "initial-greeting";
    } else {
      return "follow-up"; // Subsequent: respond based on history
    }
  }

  async execute(_prep, shared) {
    const name = shared.userName ?? "User";
    return `Hello, ${name}! What's on your mind?`;
  }

  async finalize(shared, _prep, execResult) {
    this.setFinalResponseParts(shared, [{ kind: "text", text: execResult }]);
    return "input-required"; // Pause for user response
  }
}

class FollowUpNode extends A2ABaseNode<ConversationState> {
  async prepare(shared) {
    const history = shared.__a2a_history ?? [];
    const latest = history[history.length - 1];
    return latest.parts?.find(isTextPart)?.text ?? "";
  }

  async execute(userInput, shared) {
    // Simple echo for demo; integrate LLM here for real responses
    return `Got it: "${userInput}". Anything else?`;
  }

  async finalize(shared, _prep, execResult) {
    this.setFinalResponseParts(shared, [{ kind: "text", text: execResult }]);
    return "input-required"; // Continue conversation
  }
}

// Compose flow
const greet = new GreetNode();
const followUp = new FollowUpNode();
greet.connectAction("initial-greeting", followUp); // Branch on first run
followUp.connectAction("follow-up", followUp); // Loop for multi-turn

export const conversationFlow = new Flow(greet);
```

### Resuming in A2A Server
The `PocketMeshTaskStore` automatically resumes based on `taskId`. No extra wiring needed—flows pause/resume seamlessly across messages.

> **Tip:** For termination, return `"complete"` and set final response parts. Use `emitArtifact` in `execute` for intermediate updates (e.g., generated files).

## 2. Custom Persistence Implementations

PocketMesh's default SQLite persistence is great for development, but production may require Redis, PostgreSQL, or cloud storage. Implement the `Persistence` interface to swap backends.

### The Persistence Interface
```ts
interface Persistence {
  saveRun(runId: string, state: SharedState, params: Params): Promise<void>;
  loadRun(runId: string): Promise<SharedState | null>;
  saveStep(runId: string, stepId: string, nodeName: string, result: unknown): Promise<void>;
  listRuns(): Promise<string[]>;
  deleteRun(runId: string): Promise<void>;
}
```

### Example: In-Memory Persistence (for Testing)
```ts
class InMemoryPersistence implements Persistence {
  private runs = new Map<string, { state: SharedState; steps: Map<string, unknown> }>();

  async saveRun(runId: string, state: SharedState, _params: Params) {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, { state, steps: new Map() });
    } else {
      this.runs.get(runId)!.state = state;
    }
  }

  async loadRun(runId: string): Promise<SharedState | null> {
    return this.runs.get(runId)?.state ?? null;
  }

  async saveStep(runId: string, stepId: string, nodeName: string, result: unknown) {
    const run = this.runs.get(runId);
    if (run) {
      run.steps.set(`${nodeName}-${stepId}`, result);
    }
  }

  async listRuns(): Promise<string[]> {
    return Array.from(this.runs.keys());
  }

  async deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId);
  }
}
```

### Injecting Custom Persistence
- **In Flows:** Pass to `FlowStepper` (if using stepper for manual orchestration).
- **In A2A Server:**
  ```ts
  a2aServerHandler({
    flows: { conversation: conversationFlow },
    agentCard,
    persistence: new InMemoryPersistence(), // Or your backend
  })(app, "/a2a");
  ```

> **Best Practice:** For distributed systems, use async-safe backends like Redis with TTLs for run cleanup. Always handle concurrency with locks if needed.

## 3. Advanced LLM Integration

Integrate LLMs for dynamic decision-making, content generation, or tool calling. Use nodes to wrap API calls with retries and structured outputs.

### Pattern: LLM Decision Node
```ts
import OpenAI from "openai";

class LLMBranchNode extends BaseNode<SharedState, { prompt: string }> {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async prepare(shared) {
    return shared.userInput ?? "";
  }

  async execute(userInput, shared, params) {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Classify the user intent: 'summarize' or 'analyze'." },
        { role: "user", content: `${params.prompt}: ${userInput}` },
      ],
      max_tokens: 10,
    });

    const intent = completion.choices[0].message.content?.trim().toLowerCase();
    shared.intent = intent;
    return intent;
  }

  async finalize(_shared, _prep, intent) {
    return intent === "summarize" ? "summary-path" : "analysis-path";
  }
}
```

### Streaming LLM Tokens
For real-time responses, emit text parts as artifacts during `execute`:
```ts
async execute(userInput, shared) {
  const stream = await this.openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: userInput }],
    stream: true,
  });

  let fullResponse = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? "";
    fullResponse += token;
    // Emit streaming artifact for A2A clients
    this.emitArtifact({
      artifactId: "response-stream",
      parts: [{ kind: "text", text: token }],
    });
  }

  return fullResponse;
}
```

> **Security Note:** Sanitize LLM outputs before storing in shared state or emitting as artifacts. Use libraries like `zod` for schema validation.

## 4. Complex Branching and Loops

Build decision trees, loops, or conditional pipelines with action-based routing.

### Example: Retry Loop with Max Iterations
```ts
class RetryLoopNode extends BaseNode<SharedState, { maxIterations: number }> {
  async prepare(shared) {
    shared.iteration = (shared.iteration ?? 0) + 1;
    return shared.iteration;
  }

  async execute(iteration, shared, params) {
    if (iteration > params.maxIterations) {
      throw new Error("Max iterations exceeded");
    }
    // Simulate work
    return Math.random() > 0.5 ? "success" : "retry-needed";
  }

  async finalize(shared, _prep, result) {
    if (result === "retry-needed" && shared.iteration < params.maxIterations) {
      return "loop-back"; // Route back to self
    }
    return "exit-loop";
  }
}

// In flow composition
const loopNode = new RetryLoopNode();
loopNode.connectAction("loop-back", loopNode); // Self-loop
loopNode.connectAction("exit-loop", finalNode);
```

### Guarded Branches
Use type guards or validators in `finalize` to route based on result shape:
```ts
async finalize(shared, _prep, result) {
  if (isValidSummary(result)) return "publish";
  if (isErrorResult(result)) return "fallback";
  return "default";
}
```

## 5. Error Handling and Resilience

PocketMesh handles errors gracefully with retries and fallbacks.

### Global Fallback Node
```ts
class GlobalFallbackNode extends BaseNode<SharedState> {
  async execute(_prep, shared, _params) {
    shared.error = "An unexpected error occurred. Please try again.";
    return shared.error;
  }

  async finalize(shared, _prep, execResult) {
    this.setFinalResponseParts(shared, [{ kind: "text", text: execResult }]);
    return "default";
  }
}

// Attach to flow (all unhandled actions route here)
flow.startNode.connectAction("error", new GlobalFallbackNode());
```

### Custom Retry Logic
Override `setOptions` for exponential backoff:
```ts
node.setOptions({
  maxRetries: 3,
  waitSeconds: (attempt) => Math.pow(2, attempt), // Exponential
});
```

> **Monitoring:** Hook into `onStatusUpdate` to log errors or alert on failures.

## 6. Composing Reusable Flows

Nest flows as nodes for modular design.

### Sub-Flow as Node
```ts
class SubFlowNode extends BaseNode<SharedState, Params> {
  private subFlow: Flow<SharedState>;

  constructor(subFlow: Flow<SharedState>) {
    super();
    this.subFlow = subFlow;
  }

  async execute(_prep, shared, params) {
    await this.subFlow.runLifecycle(shared, params);
    return shared.subResult;
  }

  async finalize(shared, _prep, execResult) {
    shared.mainResult = execResult;
    return "default";
  }
}

// Usage
const subFlow = new Flow(new SubNode());
const mainFlow = new Flow(new SubFlowNode(subFlow));
```

## 7. Performance Optimizations

- **Parallelism:** Set `parallel: true` on batch nodes for concurrent `executeItem` calls.
- **Caching:** Implement memoization in `prepare` using shared state.
- **Lazy Loading:** Defer heavy computations until `execute`.
- **Connection Pooling:** For LLM/API calls, reuse clients across nodes.

## Next Steps
- Explore [LLM Integration](./llm-integration.md) for structured prompting.
- See [Testing & Debugging](./testing-and-debugging.md) for advanced mocking.
- For A2A-specific patterns, refer to [A2A Agents](./a2a-agents.md).

PocketMesh's flexibility shines in complex scenarios—experiment and compose!