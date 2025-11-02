import { generateAgentCard } from "../src/a2a/agentCard";
import {
  createPocketMeshA2AServer,
  a2aServerHandler,
  PocketMeshTaskStore,
} from "../src/a2a";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";

const agentCard = generateAgentCard({
  name: "Demo",
  url: "http://localhost",
  version: "0.1.0",
  skills: [
    {
      id: "echo",
      name: "Echo",
      description: "",
      tags: [],
      inputModes: ["text"],
      outputModes: ["text"],
      examples: [],
    },
  ],
});

const flowStub = {
  runLifecycle: jest.fn(),
} as any;

describe("PocketMesh A2A index exports", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a server bundle with task store and executor", () => {
    const server = createPocketMeshA2AServer({
      flows: { echo: flowStub },
      agentCard,
    });

    expect(server.taskStore).toBeInstanceOf(PocketMeshTaskStore);
    expect(server.executor).toBeDefined();
    expect(server.requestHandler).toBeDefined();
  });

  it("delegates route registration through A2AExpressApp", () => {
    const setupSpy = jest
      .spyOn(A2AExpressApp.prototype, "setupRoutes")
      .mockImplementation((app) => app as any);

    const handler = a2aServerHandler({
      flows: { echo: flowStub },
      agentCard,
    });

    const app = { name: "mock-app" } as any;
    const middlewares = [jest.fn()];

    handler(app);
    expect(setupSpy).toHaveBeenCalledWith(app, "/a2a", undefined, undefined);

    handler(app, "/custom", middlewares, "/card.json");
    expect(setupSpy).toHaveBeenCalledWith(app, "/custom", middlewares, "/card.json");
  });
});
