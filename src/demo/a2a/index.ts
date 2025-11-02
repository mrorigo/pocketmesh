import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import { v4 as uuidv4 } from "uuid";

import {
  Flow,
  BaseNode,
  SharedState,
  Params,
} from "../../index";
import {
  generateAgentCard,
  a2aServerHandler,
  createA2AClient,
  type Artifact,
  type Message,
} from "../../a2a";

class EchoNode extends BaseNode<SharedState, Params, string, any> {
  async prepare(shared: SharedState, params: Params): Promise<string> {
    const input =
      typeof shared.input === "string"
        ? shared.input
        : typeof params.input === "string"
          ? params.input
          : "No input";
    this.flow?.onStatusUpdate?.({
      node: "EchoNode",
      state: "working",
      message: "Preparing input...",
      step: 0,
      shared,
    });
    return input;
  }

  async execute(input: string): Promise<{ result: string; artifact: Artifact }>
  {
    this.flow?.onStatusUpdate?.({
      node: "EchoNode",
      state: "working",
      message: "Echoing input...",
      step: 1,
    });

    const artifact: Artifact = {
      artifactId: uuidv4(),
      name: "echo.txt",
      description: "Echoed input as a file",
      parts: [{ kind: "text", text: input }],
    };

    this.flow?.onArtifact?.(artifact);

    return {
      result: `Echo: ${input}`,
      artifact,
    };
  }

  async finalize(
    shared: SharedState,
    _prep: string,
    execResult: { result: string },
  ): Promise<string> {
    shared.lastEcho = execResult.result;
    return "done";
  }
}

const echoFlow = new Flow(new EchoNode());

const agentCard = generateAgentCard({
  name: "PocketMesh Demo Agent",
  url: "http://localhost:4000",
  version: "0.3.0",
  description: "PocketMesh demo agent using the official @a2a-js/sdk.",
  documentationUrl: "https://github.com/mrorigo/pocketmesh",
  skills: [
    {
      id: "echo",
      name: "Echo Skill",
      description: "Echoes back the input text and emits an artifact.",
      inputModes: ["text"],
      outputModes: ["text", "file"],
      tags: ["demo"],
      examples: ["Say hello", "Repeat after me: foo"],
    },
  ],
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
});

const app = express();
app.use(compression());
app.use(bodyParser.json());

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json(agentCard);
});

a2aServerHandler({ flows: { echo: echoFlow }, agentCard })(app, "/a2a");

const PORT = 4000;

app.listen(PORT, async () => {
  console.log(`A2A demo agent listening at http://localhost:${PORT}`);

  const client = await createA2AClient(`http://localhost:${PORT}`);

  const taskId = uuidv4();
  const contextId = uuidv4();

  const message: Message = {
    kind: "message",
    messageId: uuidv4(),
    taskId,
    contextId,
    role: "user",
    metadata: { skillId: "echo" },
    parts: [{ kind: "text", text: "Hello, A2A world!" }],
  };

  console.log("\n--- Running sendMessage (blocking) ---");
  const response = await client.sendMessage({
    message,
    configuration: { blocking: true },
  });
  console.log("sendMessage response:", JSON.stringify(response, null, 2));

  console.log("\n--- Fetching task state ---");
  const taskState = await client.getTask({ id: taskId });
  console.log("getTask response:", JSON.stringify(taskState, null, 2));

  console.log("\n--- Running sendMessageStream (streaming) ---");
  const streamTaskId = uuidv4();
  const streamContextId = uuidv4();

  const stream = client.sendMessageStream({
    message: {
      kind: "message",
      messageId: uuidv4(),
      taskId: streamTaskId,
      contextId: streamContextId,
      role: "user",
      metadata: { skillId: "echo" },
      parts: [{ kind: "text", text: "Stream this!" }],
    },
    configuration: { blocking: false },
  });

  for await (const event of stream) {
    console.log("[STREAM EVENT]", JSON.stringify(event, null, 2));
  }

  console.log("Streaming completed. Demo finished.");
  process.exit(0);
});
