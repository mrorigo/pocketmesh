import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import { generateAgentCard } from "../../a2a/agentCard.js";
import { createA2AClient } from "../../a2a/client.js";
import type {
  AgentSkill,
  AgentCapabilities,
  Message,
  Artifact,
} from "../../a2a/types.js";
import { Flow, BaseNode, SharedState, Params } from "../../index.js";
import { handleA2ARequest } from "../../a2a/server/handlers.js";

// --- Demo PocketMesh flow: EchoSkill with artifact and progress ---
class EchoNode extends BaseNode<SharedState, Params, string, any> {
  async prepare(shared: SharedState, params: Params): Promise<string> {
    // Simulate progress: preparing input
    if (this.flow?.onStatusUpdate) {
      this.flow.onStatusUpdate({
        node: "EchoNode",
        state: "working",
        message: "Preparing input...",
        step: 0,
        shared,
      });
    }
    // Always use shared.input if available (set by A2A server)
    const input =
      typeof shared.input === "string"
        ? shared.input
        : typeof params.input === "string"
          ? params.input
          : "No input";
    return input;
  }
  async execute(input: string): Promise<any> {
    // Simulate progress: echoing input
    if (this.flow?.onStatusUpdate) {
      this.flow.onStatusUpdate({
        node: "EchoNode",
        state: "working",
        message: "Echoing input...",
        step: 1,
      });
    }
    // Emit an artifact (e.g., a text file)
    const artifact: Artifact = {
      name: "echo.txt",
      description: "Echoed input as a file",
      parts: [{ type: "text", text: input }],
    };
    if (this.flow?.onArtifact) {
      this.flow.onArtifact(artifact);
    }
    // Return both result and artifact for demo
    return {
      result: `Echo: ${input}`,
      __a2a_artifact: artifact,
    };
  }
  async finalize(
    shared: SharedState,
    _prep: string,
    execResult: any,
    _params: Params,
  ): Promise<string> {
    shared.lastEcho = execResult.result;
    return "done";
  }
}
const echoFlow = new Flow(new EchoNode());

// --- AgentCard config ---
const skills: AgentSkill[] = [
  {
    id: "echo",
    name: "Echo Skill",
    description: "Echoes back the input text and emits an artifact.",
    inputModes: ["text"],
    outputModes: ["text", "file"],
    tags: ["demo"],
    examples: ["Say hello", "Repeat after me: foo"],
  },
];
const capabilities: AgentCapabilities = {
  streaming: true,
  pushNotifications: false,
  stateTransitionHistory: false,
};
const agentCard = generateAgentCard({
  name: "PocketMesh Demo Agent",
  url: "http://localhost:4000/a2a",
  version: "0.1.0",
  description:
    "A demo PocketMesh agent with A2A streaming and artifact support.",
  documentationUrl: "https://github.com/your-org/pocketmesh",
  skills,
  capabilities,
});

// --- Express server setup ---
const app = express();
app.use(compression());
app.use(bodyParser.json());

// Serve agent card at /.well-known/agent.json
app.get("/.well-known/agent.json", (_req, res) => {
  res.json(agentCard);
});

// Handle A2A JSON-RPC at /a2a
app.post("/a2a", async (req, res) => {
  // For streaming, pass req/res to handleA2ARequest
  if (
    req.body &&
    typeof req.body.method === "string" &&
    req.body.method === "tasks/sendSubscribe"
  ) {
    await handleA2ARequest(
      req.body,
      { flows: { echo: echoFlow }, agentCard },
      req,
      res,
    );
    // SSE response handled inside
    return;
  }
  // Non-streaming: normal JSON-RPC
  const result = await handleA2ARequest(req.body, {
    flows: { echo: echoFlow },
    agentCard,
  });
  res.json(result);
});

// --- Start server and run client demo ---
const PORT = 4000;
app.listen(PORT, async () => {
  console.log(`A2A demo agent listening at http://localhost:${PORT}`);

  // --- Demo: A2A client sends a task to itself (non-streaming) ---
  setTimeout(async () => {
    console.log("\n--- Running A2A client demo: tasks/send ---");
    const client = createA2AClient(`http://localhost:${PORT}/a2a`);
    const taskId = "demo-task-1";
    const message: Message = {
      role: "user",
      parts: [{ type: "text", text: "Hello, A2A world!" }],
    };
    const resp = await client.sendTask(taskId, message, "echo");
    console.log("A2A client received response:", JSON.stringify(resp, null, 2));

    // --- Demo: getTask ---
    const getResp = await client.getTask(taskId);
    console.log(
      "A2A client getTask response:",
      JSON.stringify(getResp, null, 2),
    );

    // --- Demo: Streaming with sendSubscribe ---
    console.log(
      "\n--- Running A2A client demo: tasks/sendSubscribe (streaming) ---",
    );
    const streamTaskId = "demo-task-stream";
    let eventCount = 0;

    // Wait for streaming to finish before exiting
    await new Promise<void>((resolve, reject) => {
      const close = client.sendSubscribe(
        streamTaskId,
        { role: "user", parts: [{ type: "text", text: "Stream this!" }] },
        "echo",
        (event) => {
          eventCount++;
          // Optionally, deduplicate artifact events here if needed
          console.log(
            `[STREAM EVENT ${eventCount}]`,
            JSON.stringify(event, null, 2),
          );
          // Close and resolve when completed
          if (
            "status" in event &&
            event.status &&
            event.status.state === "completed"
          ) {
            close();
            // Wait a tick to flush output
            setTimeout(resolve, 100);
          }
        },
        (err) => {
          // Only log real errors (AbortError is suppressed in client)
          console.error("Streaming error:", err);
          reject(err);
        },
      );
    });
    // Exit process after streaming
    process.exit(0);
  }, 1000);
});

/**
 * Developer Notes:
 * - EchoNode emits progress via onStatusUpdate and an artifact via onArtifact.
 * - The server handler passes req/res to handleA2ARequest for streaming.
 * - The client demo uses sendSubscribe to print streaming events in real time.
 * - Extend this pattern for your own multi-step, multi-artifact flows!
 */
