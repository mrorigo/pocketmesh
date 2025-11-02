# PocketMesh Repository: Agent Playbook

Welcome! This document is the single source of truth for AI agents (and human copilots) contributing to the **PocketMesh** repository. Follow these guidelines to deliver accurate, maintainable updates while keeping the project healthy.

---

## 1. Repository Snapshot

| Item | Details |
| --- | --- |
| **Project** | PocketMesh – TypeScript framework for agentic flows with A2A support |
| **Language** | TypeScript (Node ≥ 18) |
| **Package name / version** | `pocketmesh@0.3.0` |
| **Key Dependencies** | `@a2a-js/sdk`, `express`, `better-sqlite3`, `typescript`, `jest`, `ts-jest` |
| **Build command** | `npm run build` (runs `tsc`) |
| **Test command** | `npm test` (coverage enabled by default) |
| **Main docs** | `README.md`, `docs/developer/*`, `docs/agent-prompt.md`, `docs/MIGRATION_TO_0.3.md` |

---

## 2. Code Layout

```
.
├── src/
│   ├── core/                 # Flow + node abstractions
│   ├── a2a/                  # SDK bridge (PocketMeshExecutor, TaskStore, helpers)
│   ├── utils/                # Logger, retry, persistence (SQLite default)
│   ├── demo/                 # Examples, including A2A demo
│   └── index.ts              # Barrel exports
├── docs/
│   ├── developer/            # Detailed walkthroughs for humans & agents
│   ├── agent-prompt.md       # Canonical agent prompt for PocketMesh 0.3.0
│   └── MIGRATION_TO_0.3.md   # Upgrade notes
├── __tests__/                # Jest test suites
├── README.md                 # Project overview + usage
├── AGENTS.md                 # (You're reading it!)
├── package.json              # Scripts, dependencies, version
└── tsconfig.json             # TS build settings (paths map @a2a-js/sdk/*)
```

---

## 3. Workflow for Agents

1. **Understand the task**  
   Read the request carefully. Check related files (README, docs, source) for context.

2. **Locate relevant modules**  
   - Flows & nodes: `src/core/*`
   - A2A integration: `src/a2a/*`
   - Utilities: `src/utils/*`

3. **Make changes**  
   - Update TypeScript files with strong typings.  
   - Maintain existing conventions (logging, hook usage, error handling).  
   - Use `apply_patch` or equivalent to edit files.

4. **Update docs/tests**  
   - Document new features or breaking changes in README/developer docs.  
   - Extend Jest tests to cover new logic.

5. **Run local checks** (when allowed)  
   ```bash
   npm run build        # Ensure TypeScript passes
   npm test -- --coverage   # Verify tests + coverage
   ```
   > If the current environment blocks execution, request the human to run these commands.

6. **Summarise work**  
   - Provide an explicit summary of code changes.  
   - Note any manual steps required (e.g., run tests).

---

## 4. Testing Expectations

- **Test framework:** Jest (`ts-jest` for TS support).
- **Coverage:** `collectCoverage` is enabled. Aim for 80%+ overall with attention to branching.
- **Existing suites:** Cover core flows, A2A TaskStore/Executor, persistence, and developer docs. Extend as needed.
- **Adding tests:** Place new tests under `__tests__`. Follow existing patterns (use in-memory persistence mocks, stub SDK clients, etc.).

---

## 5. A2A Integration Highlights

- PocketMesh relies on `@a2a-js/sdk` (v0.3+) for server/client features.
- Helpers available via `import { ... } from "pocketmesh/a2a";` include:
  - `createPocketMeshA2AServer`, `a2aServerHandler`
  - `generateAgentCard`, `createA2AClient`
  - `A2ABaseNode`, `PocketMeshTaskStore`, `PocketMeshExecutor`
  - Re-exported types (`Message`, `Part`, `Artifact`, etc.) and guards (`isTextPart`, …)
- Agent card serving path: `/.well-known/agent-card.json`
- Streaming uses SDK async generators (`client.sendMessageStream`).

For a deeper dive, consult:
- `docs/developer/a2a-agents.md`
- `docs/developer/llm-integration.md`
- `docs/agent-prompt.md` (canonical instructions for code-generating agents)

---

## 6. Persistence & State

- Default persistence is SQLite (`pocketmesh.sqlite`).  
  API: `src/utils/persistence.ts`
- Runs/steps/task snapshots are recorded for flow resumption and A2A history.
- Custom persistence can be injected wherever the `Persistence` interface is accepted (A2A server, FlowStepper).
- The task store (`PocketMeshTaskStore`) bridges SDK tasks with PocketMesh persistence.

---

## 7. LLM & External API Integration

- Keep LLM calls inside node `execute` methods (or `executeItem` for batches).
- Apply retries (`node.setOptions({ maxRetries })`).
- Sanitise outputs before storing in shared state or final responses.
- Streaming: emit artifacts inside `execute` and rely on `onArtifact`/A2A streaming to forward updates.
- See `docs/developer/llm-integration.md` for blueprints.

---

## 8. Pull Request Preparation

When finishing a task, ensure:

- ✅ TypeScript compiles (`npm run build`)
- ✅ Tests pass (`npm test -- --coverage`)
- ✅ Documentation updated if behaviour changes
- ✅ Summary includes:
  - A bullet list of code changes
  - Tests run (or note if blocked)
  - Follow-up actions for the human (if any)

---

## 9. Need More Guidance?

- **Architecture:** `docs/developer/architecture.md`
- **Quickstart flow:** `docs/developer/quickstart-flow.md`
- **Testing recipes:** `docs/developer/testing-and-debugging.md`
- **Advanced patterns:** `docs/developer/advanced-patterns.md` (if added later)
- **Migration notes:** `docs/MIGRATION_TO_0.3.md`

---

## 10. Agent Etiquette

- Stay within the task scope. If requirements are ambiguous, request clarification.
- Preserve existing logging, error handling, and project structure.
- Prefer additive changes over wholesale rewrites unless requested.
- Leave TODO comments sparingly (ideally none); complete the work instead.
- Always provide helpful context in your final response.

Happy hacking! PocketMesh thrives when agents collaborate with clear structure and thoughtful code.
