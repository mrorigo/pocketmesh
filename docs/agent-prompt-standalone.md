---
layout: default
title: "Agentic Coding (TypeScript) — PocketMesh 0.3.0"
---

# Agentic Coding: Collaborative Ecosystems with PocketMesh 0.3.0 + A2A

> **This is the canonical prompt & playbook for AI agents or developers building PocketMesh 0.3.0 projects.**  
> Embrace the vision of interoperable, modular agent-to-agent (A2A) systems: specialized agents collaborating as peers under open standards. Follow these guidelines to create robust, type-safe workflows that align with A2A principles—peer-first collaboration, standardization, modularity, secure opacity, dynamic discovery, transparency, human alignment, and scalability.

---

## Quick Checklist (Read First!)

- **Core Imports:**  
  ```ts
  import { Flow, BaseNode, SharedState, Params, ActionKey } from "pocketmesh";
  import {
    A2ABaseNode,
    createPocketMeshA2AServer,
    a2aServerHandler,
    createA2AClient,
    generateAgentCard,
    isTextPart, isDataPart, isFilePart,
    Message, Part, Artifact,
  } from "pocketmesh/a2a";
  ```
- **Strict Typing:** Define explicit interfaces for `SharedState` and `Params`. Use generics for node inputs/outputs. Avoid `any` to ensure type-safe handoffs.
- **Node Lifecycle:** Implement `prepare`, `execute`, and `finalize`. For batch nodes, provide `executeItem` + a dummy `execute` (throw error). Extend `A2ABaseNode` for A2A-aware nodes.
- **Retries & Resilience:** Use `node.setOptions({ maxRetries, waitSeconds, parallel })`. Implement `executeFallback`/`executeItemFallback` for fault tolerance. Plan for graceful degradation.
- **A2A Protocol Compliance:** Expose agent cards at `/.well-known/agent-card.json`. Use structured messages (schemas for parts, artifacts). Support lifecycle states (submitted → working → completed).
- **Modularity:** Design nodes around specialized skills. Use clear boundaries, structured handoffs (versioned schemas), and loose coupling. Avoid monolithic nodes.
- **Persistence:** Default SQLite (`pocketmesh.sqlite`) for runs/steps/tasks. Inject custom `Persistence` for scalability (e.g., Redis). Map A2A tasks to flows via `PocketMeshTaskStore`.
- **Observability:** Instrument logging (`logger.ts`), trace handoffs, emit artifacts for auditing. Hook into `onStatusUpdate` and `onArtifact`.
- **Testing:** Jest (`npm test -- --coverage`). Cover orchestration, retries, A2A integration, and edge cases. Aim for 80%+ coverage.
- **Best Practices Alignment:** Follow A2A manifesto—publish capabilities, ensure discoverability, secure transports, human-in-the-loop. Avoid free-form text; use validated schemas.

---

## 1. Requirements & Vision Alignment

- **Gather Requirements:** Define skills (e.g., "greet", "analyze"), input/output modes (text, data, file), examples, tags. Consider latency, streaming, push notifications.
- **Align with A2A Principles:** 
  - **Peer-First:** Agents as collaborators, not tools. Expose endpoints for discovery.
  - **Modularity:** Break tasks into specialized nodes (e.g., one for LLM calls, one for validation).
  - **Security:** Authenticate via agent cards; gate tools/capabilities (least-privilege).
  - **Dynamic Discovery:** Advertise skills in agent cards for runtime routing.
  - **Human Alignment:** Include checkpoints for oversight; trace provenance.
- **External Dependencies:** LLMs (e.g., OpenAI), APIs, tools. Sanitize inputs/outputs; handle credentials securely.
- **Architecture Choice:** Sequential for linear tasks; hierarchical for oversight; mesh for peer collaboration. Start simple, evolve to composable ecosystems.

---

## 2. Designing Flows: Modular & Composable

### Flow Anatomy
PocketMesh flows orchestrate nodes in patterns inspired by A2A architectures:

```mermaid
graph LR
  Start[Start Node<br/>(Prepare Inputs)] --> Branch{Decision?}
  Branch -->|default| Linear[Sequential Nodes]
  Branch -->|action: 'parallel'| Batch[Batch Node<br/>(Fan-Out)]
  Batch --> Aggregate[Finalize & Aggregate]
  Linear --> End[Output Node<br/>(Set Response)]
  Branch -->|action: 'escalate'| Supervisor[Hierarchical<br/>(Delegate to Sub-Flow)]
  Supervisor --> End
```

- **Sequential/Pipeline:** Fixed chain for linear workflows (e.g., greet → validate → respond).
- **Hierarchical:** Supervisor node delegates to specialists (e.g., route to LLM or remote agent).
- **Batch/Parallel:** `executeItem` for concurrent processing (set `parallel: true`).
- **Dynamic Routing:** Use semantic intent in `finalize` for mesh-like adaptability.
- **Shared State & Params:** Mutable state for context; params for inputs. Include A2A fields:

```ts
interface AgenticState {
  result?: string;
  intent?: string;
  // A2A auto-populated:
  __a2a_incoming_message?: Message;
  __a2a_history?: Message[];
  __a2a_final_response_parts?: Part[];
  __a2a_artifacts?: Artifact[];
  __a2a_task_id?: string;
}

interface AgenticParams {
  skillId?: string;
  input?: string;
  shout?: boolean;
}
```

- **Do's:** Define clear boundaries; use structured schemas for handoffs; plan for discovery/escalation.
- **Don'ts:** Avoid rigid wiring—use actions for flexibility; don't ignore state management.

---

## 3. Implementing Nodes: Specialized & Resilient

### Base Node Template
Nodes are the atoms of modularity—each owns a skill with prepare/execute/finalize lifecycle.

```ts
class GreetNode extends BaseNode<AgenticState, AgenticParams, string, string, ActionKey> {
  async prepare(shared, params): Promise<string> {
    return params.input ?? shared.__a2a_incoming_message?.parts?.find(isTextPart)?.text ?? "World";
  }

  async execute(name: string, shared: AgenticState, params: AgenticParams, attempt: number): Promise<string> {
    if (attempt > 1) console.log(`Retry attempt ${attempt} for greet`);
    return params.shout ? `HELLO, ${name.toUpperCase()}!` : `Hello, ${name}!`;
  }

  async executeFallback(name: string, shared: AgenticState, params: AgenticParams, attempt: number): Promise<string> {
    return "Fallback: Hello, friend!"; // Graceful degradation
  }

  async finalize(shared: AgenticState, prep: string, execResult: string, params: AgenticParams): Promise<ActionKey> {
    shared.result = execResult;
    if (params.escalate) return "escalate"; // Route to supervisor
    return ActionKey.Default;
  }
}
```

### Batch Node Pattern
For parallelizable work (e.g., multi-language greetings).

```ts
class MultiGreetNode extends BaseNode<AgenticState, AgenticParams, string[], string[], ActionKey> {
  async prepare(shared): Promise<string[]> {
    return ["English", "Spanish", "French"].map(lang => `${shared.result} in ${lang}`);
  }

  async execute(_prep: string[], _shared: AgenticState, _params: AgenticParams, _attempt: number): Promise<string[]> {
    throw new Error("Use executeItem for batch");
  }

  async executeItem(item: string, _shared: AgenticState, _params: AgenticParams, _attempt: number): Promise<string> {
    // Simulate translation API call
    return item.replace("Hello", "Hola"); // Placeholder
  }

  async executeItemFallback(item: string, _shared: AgenticState, _params: AgenticParams, _attempt: number): Promise<string> {
    return item; // Fallback to original
  }

  async finalize(shared: AgenticState, _prep: string[], execResults: string[]): Promise<ActionKey> {
    shared.translations = execResults;
    return ActionKey.Default;
  }
}

const node = new MultiGreetNode();
node.setOptions({ maxRetries: 3, waitSeconds: (attempt) => 2 ** attempt, parallel: true });
```

### A2A-Aware Node (`A2ABaseNode`)
For protocol-compliant interactions.

```ts
class A2AHandleNode extends A2ABaseNode<AgenticState, AgenticParams> {
  async prepare(shared: AgenticState): Promise<Message | null> {
    const message = this.getIncomingMessage(shared);
    if (!message) throw new Error("No incoming A2A message");
    const textPart = this.getIncomingParts(shared).find(isTextPart);
    shared.intent = textPart?.text; // Structured handoff
    return message;
  }

  async execute(_prep: Message, shared: AgenticState, _params: AgenticParams, _attempt: number): Promise<Artifact> {
    const artifact: Artifact = {
      artifactId: randomUUID(),
      name: "processed-input",
      parts: [createTextPart(shared.intent ?? "Default")],
    };
    this.emitArtifact(shared, artifact); // For streaming/traceability
    return artifact;
  }

  async finalize(shared: AgenticState, _prep: Message, execResult: Artifact): Promise<ActionKey> {
    this.setFinalResponseParts(shared, execResult.parts);
    shared.__a2a_artifacts?.push(execResult);
    return ActionKey.InputRequired; // Pause for multi-turn
  }
}
```

- **Do's:** Specialize nodes (e.g., one for routing, one for execution); version schemas; include fallbacks.
- **Don'ts:** Don't overload nodes—keep scoped; avoid unvalidated free-form text.

---

## 4. Assembling the Flow: Orchestration Patterns

Compose for your architecture:

```ts
const greet = new GreetNode();
const branch = new BranchNode(); // Intent classifier
const multi = new MultiGreetNode();
const a2aHandle = new A2AHandleNode();
const fallback = new FallbackNode(); // Global error handler

// Sequential base
greet.connectTo(branch);

// Hierarchical branching
branch.connectAction("multi-lang", multi);
branch.connectAction("a2a-process", a2aHandle);

// Mesh-like: dynamic peer call
branch.connectAction("remote", new CallRemoteNode());

// Fallback for unhandled
greet.connectAction(ActionKey.Error, fallback);

export const agenticFlow = new Flow(greet);

// Observability
agenticFlow.onStatusUpdate = (status) => logger.info(`Flow: ${status}`);
agenticFlow.onArtifact = (artifact) => logger.debug(`Artifact: ${artifact.name}`);
```

- **Patterns:** Pipeline for simplicity; supervisor for complex delegation; registry for discovery (e.g., query agent cards).
- **Scalability:** Design for evolution—add nodes without rewiring.

---

## 5. Exposing Flows as A2A Agents: Interoperable APIs

### Agent Card: Discovery & Capabilities
Publish a standardized card for peer discovery.

```ts
import { randomUUID } from "crypto";

const agentCard = generateAgentCard({
  name: "PocketMesh Collaborator",
  url: "https://my-agent.example.com",
  version: "1.0.0",
  protocolVersion: "0.3.0",
  skills: [
    {
      id: "greet-multi",
      name: "Multi-Language Greeting",
      description: "Greets in multiple languages with optional shouting.",
      inputModes: ["text"],
      outputModes: ["text", "json"],
      tags: ["communication", "demo"],
      examples: ["Greet 'Alice' in English and Spanish"],
    },
  ],
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true, // For traceability
  },
  // Security: scopes for tools
  scopes: [{ skillId: "greet-multi", permissions: ["read", "write"] }],
});
```

Serve at `/.well-known/agent-card.json`.

### Server Setup: Secure & Observable
```ts
import express from "express";
const app = express();
app.use(express.json());

// Card endpoint
app.get("/.well-known/agent-card.json", (_req, res) => res.json(agentCard));

// A2A routes (JSON-RPC, SSE streaming)
a2aServerHandler({
  flows: { greet: agenticFlow },
  agentCard,
  persistence: defaultPersistence, // Or custom
  // Custom executor for oversight
  executor: new PocketMeshExecutor({ onError: (err) => logger.error(err) }),
})(app, "/a2a");

app.listen(4000, () => logger.info("A2A peer ready at http://localhost:4000"));
```

- **Do's:** Version cards/schemas; secure transports (HTTPS); audit interactions.
- **Don'ts:** Don't expose internals—opaque collaboration; avoid proprietary glue.

For custom servers: `createPocketMeshA2AServer({ ... }).setup(app, "/a2a")`.

---

## 6. Calling Peers: Client-Side Collaboration

Integrate remote agents as nodes for mesh ecosystems.

```ts
import { randomUUID } from "crypto";

class PeerCallNode extends BaseNode<AgenticState, { peerUrl: string; skillId: string }, string, Message, ActionKey> {
  async prepare(shared): Promise<string> {
    return shared.intent ?? "";
  }

  async execute(query: string, _shared: AgenticState, params: AgenticParams, _attempt: number): Promise<Message> {
    const client = await createA2AClient(params.peerUrl);
    const response = await client.sendMessage({
      message: {
        kind: "message",
        role: "user",
        messageId: randomUUID(),
        taskId: randomUUID(),
        contextId: randomUUID(),
        metadata: { skillId: params.skillId },
        parts: [createTextPart(query)],
      },
      configuration: { blocking: true, modelPreferences: { temperature: 0.7 } },
    });
    if (response.error) throw new Error(`Peer failed: ${response.error.message}`);
    return response.result ?? { parts: [] };
  }

  async finalize(shared: AgenticState, _prep: string, peerResponse: Message): Promise<ActionKey> {
    const text = peerResponse.parts?.find(isTextPart)?.text;
    shared.peerResult = text;
    this.setFinalResponseParts(shared, peerResponse.parts ?? []);
    return ActionKey.Default;
  }
}
```

For streaming: Use `sendMessageStream` and process events (e.g., emit artifacts on updates).

- **Dynamic Discovery:** Query peer cards to select based on skills.
- **Fault Tolerance:** Retry on peer failures; fallback to local nodes.

---

## 7. Persistence & Stateful Workflows: Traceable & Resumable

- **Default:** SQLite for runs/steps/tasks. `PocketMeshTaskStore` bridges A2A tasks to flows.
- **Custom Implementation:** For scalability, implement `Persistence` (save/load runs, steps; list/delete).

```ts
interface Persistence {
  saveRun(runId: string, state: SharedState, params: Params): Promise<void>;
  loadRun(runId: string): Promise<SharedState | null>;
  saveStep(runId: string, stepId: string, nodeName: string, result: unknown): Promise<void>;
  listRuns(): Promise<string[]>;
  deleteRun(runId: string): Promise<void>;
}

// Inject:
a2aServerHandler({ ..., persistence: new RedisPersistence() });
```

- **Multi-Turn:** Return `ActionKey.InputRequired` to pause. Resume on next message with same `taskId`. History in `__a2a_history`.
- **Do's:** Compact memory; retain provenance. **Don'ts:** Don't assume stateless—plan for loops/branches.

---

## 8. LLM & Tool Integration: Optimized & Aligned

Wrap in nodes for modularity; optimize per skill (smaller models for routing).

```ts
class LLMDecisionNode extends BaseNode<AgenticState, { prompt: string }, string, string, ActionKey> {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async execute(query: string, shared: AgenticState, params: AgenticParams, _attempt: number): Promise<string> {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-optimized
      messages: [
        { role: "system", content: params.prompt },
        { role: "user", content: query },
      ],
      max_tokens: 50,
    });
    const output = completion.choices[0].message.content?.trim();
    // Sanitize/validate (e.g., Zod schema)
    shared.llmOutput = output;
    return output ?? "No response";
  }

  async finalize(shared: AgenticState, _prep: string, llmResult: string): Promise<ActionKey> {
    return llmResult.includes("summarize") ? "summary" : "analyze";
  }
}
```

- **Streaming:** Emit token-by-token artifacts in `execute`.
- **Do's:** Retry LLM calls; human checkpoints for alignment. **Don'ts:** Don't use largest model everywhere—optimize costs.

---

## 9. Testing Strategy: Comprehensive Coverage

- **Unit:** Test node lifecycles, shared state mutations.
- **Integration:** Mock persistence/A2A; test flows end-to-end.
- **A2A:** Use `supertest` for RPC/SSE; simulate peer calls.
- **Resilience:** Cover retries, fallbacks, errors.

```bash
npm test          # All tests
npm test -- --watch  # TDD mode
npm test -- --coverage  # Reports (80%+ goal)
```

- Focus: Branching, multi-turn, artifact emission, protocol compliance.

---

## 10. Deliverables & Quality Gates

- **Code:** Flows, nodes, A2A wiring (Express/server).
- **Docs:** Update README; add skill examples to agent card.
- **Tests:** Jest suite with coverage.
- **Checks:** `npm run build` (TS); `npm test -- --coverage`.
- **Summary:** Bullet changes; note manual steps (e.g., deploy).
- **Evolution:** Version schemas; plan for new peers.

Reference structure:
```
my-ecosystem/
├── src/
│   ├── flows/agentic-flow.ts
│   ├── nodes/ (specialized nodes)
│   ├── server/a2a-setup.ts
│   └── index.ts
├── __tests__/ (full coverage)
├── docs/ (skill guides)
└── package.json
```

---

## Final Reminder for AI Agents

- Import from barrel (`"pocketmesh"`); respect A2A schemas (Message, Part, etc.).
- Build modular: specialized, discoverable, secure agents.
- Ensure traceability: log handoffs, emit artifacts, align with humans.
- Test rigorously; iterate on patterns (sequential → hierarchical → mesh).

**Build collaborative A2A ecosystems with PocketMesh—where agents compose greater wholes!**
