---
layout: default
title: "Agentic Coding (TypeScript) — PocketMesh 0.3.0"
---

# Agentic Coding: Collaborative Ecosystems with PocketMesh 0.3.0 + A2A

> **This is the canonical prompt & playbook for AI agents or developers building PocketMesh 0.3.0 projects.**  
> Align with the [A2A Manifesto](./MANIFESTO.md) for peer-first, modular, interoperable agents. Follow [A2A Guide](./A2A-GUIDE.md) patterns (sequential, hierarchical, mesh) and best practices (structured handoffs, observability, security). Use this as a high-level guide; dive into [developer docs](./developer/) for details.

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
- **Strict Typing:** Define interfaces for `SharedState` and `Params`. Use generics for node I/O.
- **Node Lifecycle:** Implement `prepare`, `execute`, `finalize`. For batch: `executeItem` + dummy `execute`. Extend `A2ABaseNode` for A2A.
- **Resilience:** `node.setOptions({ maxRetries, waitSeconds, parallel })`; add `executeFallback`.
- **A2A Compliance:** Structured messages/artifacts; expose cards at `/.well-known/agent-card.json`.
- **Modularity:** Specialized nodes; versioned schemas; loose coupling. See [architecture.md](./developer/architecture.md).
- **Persistence:** Default SQLite; inject custom via `Persistence` interface. See [persistence-and-state.md](./developer/persistence-and-state.md).
- **Observability:** Log via `utils/logger.ts`; hook `onStatusUpdate`/`onArtifact`.
- **Testing:** Jest (`npm test -- --coverage`); 80%+ coverage. See [testing-and-debugging.md](./developer/testing-and-debugging.md).
- **Principles:** Peer discovery, secure opacity, traceability, human-in-loop. Avoid monoliths/free-form text.

---

## 1. Requirements & Alignment

- Define skills (ID, description, modes, examples) per [A2A Guide Do's](#dos--donts).
- Align with manifesto: modularity (specialized agents), standardization (open SDK), dynamic discovery (cards).
- Consider architecture: sequential for pipelines; hierarchical for delegation; mesh for peers.
- Dependencies: LLMs/tools—sanitize outputs, optimize models. See [llm-integration.md](./developer/llm-integration.md).

---

## 2. Designing Flows

See [architecture.md](./developer/architecture.md) for core blocks (nodes, flows, persistence) and [advanced-patterns.md](./developer/advanced-patterns.md) for multi-turn/loops.

- **Anatomy:** Start → Branch (actions) → Batch/Parallel → End. Use shared state for context; params for inputs.
- **Patterns:** 
  - Sequential: Chain nodes ([quickstart-flow.md](./developer/quickstart-flow.md)).
  - Hierarchical: Supervisor routes to specialists.
  - Batch: `parallel: true` for fan-out.
- **State Example:**
  ```ts
  interface AgenticState {
    result?: string;
    // A2A fields auto-populated
    __a2a_history?: Message[];
    __a2a_final_response_parts?: Part[];
  }
  interface AgenticParams { input?: string; skillId?: string; }
  ```
- **Do's/Don'ts:** Clear boundaries; fallbacks. Avoid rigid wiring—use dynamic actions.

---

## 3. Implementing Nodes

See [quickstart-flow.md](./developer/quickstart-flow.md) for basics; [advanced-patterns.md](./developer/advanced-patterns.md) for LLM/branching.

- **Base Template:** Extend `BaseNode<SharedState, Params, Prep, Exec, ActionKey>`.
  ```ts
  class SkillNode extends BaseNode<AgenticState, AgenticParams, string, string, ActionKey> {
    async prepare(shared, params): Promise<string> { /* Derive input */ }
    async execute(prep: string, shared, params, attempt: number): Promise<string> { /* Core work */ }
    async finalize(shared, prep, result, params): Promise<ActionKey> { /* Route */ return ActionKey.Default; }
  }
  ```
- **Batch:** Implement `executeItem`; set `parallel`.
- **A2A Node:** Extend `A2ABaseNode`; use `getIncomingParts`, `setFinalResponseParts`, `emitArtifact`.
  ```ts
  class A2ANode extends A2ABaseNode<AgenticState, AgenticParams> {
    async execute(_prep, shared): Promise<void> {
      this.emitArtifact(shared, { artifactId: randomUUID(), parts: [createTextPart("Update")] });
    }
    async finalize(shared): Promise<ActionKey> {
      this.setFinalResponseParts(shared, [{ kind: "text", text: shared.result ?? "" }]);
      return ActionKey.InputRequired; // For multi-turn
    }
  }
  ```
- **Resilience:** Add fallbacks; retry LLM calls. Sanitize for security.

---

## 4. Assembling Flows

See [quickstart-flow.md](./developer/quickstart-flow.md) example.

```ts
const start = new SkillNode();
const branch = new BranchNode();
const batch = new BatchNode();

start.connectTo(branch);
branch.connectAction("batch", batch);

export const flow = new Flow(start);
flow.onStatusUpdate = (status) => console.log(status); // Traceability
```

- Add global fallback: `start.connectAction(ActionKey.Error, fallbackNode)`.
- For composition: Nest sub-flows as nodes ([advanced-patterns.md](./developer/advanced-patterns.md)).

---

## 5. Exposing as A2A Agents

See [a2a-agents.md](./developer/a2a-agents.md).

- **Card:** `generateAgentCard({ name, url, skills: [{ id, description, modes, examples }] })`.
- **Server:**
  ```ts
  import express from "express";
  const app = express();
  app.use(express.json());
  app.get("/.well-known/agent-card.json", (_, res) => res.json(card));
  a2aServerHandler({ flows: { skill: flow }, agentCard })(app, "/a2a");
  app.listen(4000);
  ```
- Custom: `createPocketMeshA2AServer({ persistence: custom })`.
- **Do's:** Version cards; secure endpoints. **Don'ts:** Expose internals.

---

## 6. Calling Peers (Clients)

See [a2a-agents.md](./developer/a2a-agents.md).

```ts
class PeerNode extends BaseNode<AgenticState, { peerUrl: string }, string, Message, ActionKey> {
  async execute(query: string, _shared, params): Promise<Message> {
    const client = await createA2AClient(params.peerUrl);
    return client.sendMessage({ message: { /* structured */ parts: [createTextPart(query)] }, configuration: { blocking: true } });
  }
  async finalize(shared, _prep, response: Message): Promise<ActionKey> {
    this.setFinalResponseParts(shared, response.parts ?? []);
    return ActionKey.Default;
  }
}
```

- Streaming: `sendMessageStream`; emit on events.
- Discovery: Query peer cards for skills.

---

## 7. Persistence & Multi-Turn

See [persistence-and-state.md](./developer/persistence-and-state.md).

- Default: SQLite maps tasks to runs.
- Multi-Turn: `ActionKey.InputRequired` pauses; resume on `taskId`.
- Custom: Implement `Persistence`; inject into handler.

---

## 8. LLM/Tools Integration

See [llm-integration.md](./developer/llm-integration.md).

- Wrap in nodes: Retry calls; validate outputs (e.g., Zod).
- Streaming: Emit tokens as artifacts.
- Optimize: Smaller models for routing; human checkpoints.

---

## 9. Testing

See [testing-and-debugging.md](./developer/testing-and-debugging.md).

- Unit: Nodes/flows.
- Integration: Mock A2A/persistence.
- Run: `npm test -- --coverage`.

---

## 10. Deliverables

- Code: Flows/nodes/server.
- Tests: 80%+ coverage.
- Docs: Update README; skill examples.
- Checks: `npm run build && npm test`.
- Structure: `src/flows/`, `src/nodes/`, `__tests__/`.

---

## Final Reminder

- Barrel imports; A2A schemas.
- Modular, traceable, aligned agents.
- Reference developer docs for depth.

**Build interoperable A2A ecosystems—agents as peers, composing greater wholes!**
