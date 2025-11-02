# Testing & Debugging PocketMesh Projects

Rigorous testing keeps your flows reliable, especially when they orchestrate external APIs or LLMs. This guide outlines the recommended testing strategy and debugging tricks for PocketMesh.

## Jest setup

PocketMesh includes a ready-to-go `jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  roots: ["<rootDir>/__tests__"],
  collectCoverage: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
};
```

Run tests with:

```bash
npm test            # standard run
npm test -- --watch # watch mode
npm test -- --coverage # coverage reports (default)
```

## Unit testing flows

1. Instantiate nodes and flows directly.
2. Provide explicit shared state and params.
3. Assert on shared state mutations and returned actions.

```ts
import { greetingFlow } from "../src/flows/greeting-flow";

describe("greeting flow", () => {
  it("shouts when the flag is set", async () => {
    const shared: any = {};
    await greetingFlow.runLifecycle(shared, { name: "Mesh", shout: true });
    expect(shared.result).toMatch(/HELLO/);
  });
});
```

## Mocking dependencies

### LLMs or API clients

- Use `jest.mock` to stub the module or inject a fake client into your node.
- Test fallback paths by rejecting once and succeeding later to exercise retry behaviour.

### Persistence

- Provide an in-memory `Persistence` implementation (like the one used in `__tests__/a2a-sdk.test.ts`).
- Useful for verifying `addStep`, `updateRunStatus`, and snapshot storage.

## Testing A2A integrations

- Use `createPocketMeshA2AServer` to build a server bundle and assert route registration with spies.
- For end-to-end tests, use `supertest` to POST JSON-RPC requests and inspect responses.
- Mock `@a2a-js/sdk` clients to control streaming behaviour.

```ts
import request from "supertest";
import express from "express";
import { a2aServerHandler, generateAgentCard } from "pocketmesh/a2a";
import { greetingFlow } from "../src/flows/greeting-flow";

const app = express();
app.use(express.json());

const card = generateAgentCard({ /* ... */ });
a2aServerHandler({ flows: { greet: greetingFlow }, agentCard: card })(app, "/a2a");

const response = await request(app)
  .post("/a2a")
  .send({
    jsonrpc: "2.0",
    id: "task-1",
    method: "message/send",
    params: { message: { /* ... */ } },
  });

expect(response.body.result).toBeDefined();
```

## Coverage targets

- Aim for 80–90% overall, focusing on branch coverage in `src/core/flow.ts`.
- `npm test -- --coverage` produces both CLI summary and `coverage/lcov-report/index.html`.
- Add targeted tests for fallback branches, batch nodes, and cancellations.

## Logging & debugging

- PocketMesh uses Winston under the hood. Set `POCKETMESH_LOG_LEVEL=debug` to increase verbosity.
- Add `flow.onStatusUpdate` hooks in tests to verify lifecycle progress.
- When debugging streaming, log each artifact or status event to confirm order and content.

## Common pitfalls & fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Shared state missing fields | Node didn’t set defaults or `shared` is mis-typed | Define interfaces and initialise fields in `prepare` |
| Tests flaky around LLM calls | Real API calls during tests | Mock the client or inject deterministic helpers |
| Coverage gaps in Flow | Not covering fallback branches | Add tests that throw during `prepare`, `execute`, `executeItem`, `finalize` |
| Persistence mismatch | Custom persistence missing methods | Implement full `Persistence` interface or reuse SQLite |

## Next steps

- Dive into [advanced-patterns.md](./advanced-patterns.md) for high-level recipes.
- Revisit [architecture.md](./architecture.md) to align concepts with your test strategy.

Happy testing!
