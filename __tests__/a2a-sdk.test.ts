import { v4 as uuidv4 } from "uuid";
import {
  RequestContext,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";

import {
  PocketMeshTaskStore,
  PocketMeshExecutor,
} from "../src/a2a";
import type {
  Persistence,
  RunRecord,
  StepRecord,
} from "../src/utils/persistence";
import type {
  Message,
  Task,
} from "../src/a2a/types";

class TestPersistence implements Persistence {
  private runSeq = 0;
  private stepSeq = 0;
  private runs = new Map<number, RunRecord>();
  private steps = new Map<number, StepRecord[]>();
  private taskMap = new Map<string, number>();
  private snapshots = new Map<string, Record<string, unknown>>();

  createRun(flowName: string): number {
    const id = ++this.runSeq;
    this.runs.set(id, {
      id,
      flow_name: flowName,
      created_at: new Date().toISOString(),
      status: "submitted",
    });
    this.steps.set(id, []);
    return id;
  }

  getRun(runId: number): RunRecord | undefined {
    return this.runs.get(runId);
  }

  updateRunStatus(runId: number, status: string): void {
    const run = this.runs.get(runId);
    if (run) run.status = status;
  }

  addStep(
    runId: number,
    nodeName: string,
    action: string | null,
    stepIndex: number,
    sharedState: object,
  ): number {
    const list = this.steps.get(runId);
    if (!list) throw new Error("Unknown run");
    const id = ++this.stepSeq;
    list.push({
      id,
      run_id: runId,
      node_name: nodeName,
      action,
      step_index: stepIndex,
      shared_state_json: JSON.stringify(sharedState),
      created_at: new Date().toISOString(),
    });
    return id;
  }

  getStepsForRun(runId: number): StepRecord[] {
    return [...(this.steps.get(runId) ?? [])];
  }

  getLastStep(runId: number): StepRecord | undefined {
    const list = this.steps.get(runId) ?? [];
    return list[list.length - 1];
  }

  getStepByIndex(runId: number, stepIndex: number): StepRecord | undefined {
    return (this.steps.get(runId) ?? []).find(
      (step) => step.step_index === stepIndex,
    );
  }

  deleteRun(runId: number): void {
    this.runs.delete(runId);
    this.steps.delete(runId);
    for (const [taskId, mappedRunId] of this.taskMap.entries()) {
      if (mappedRunId === runId) {
        this.taskMap.delete(taskId);
        this.snapshots.delete(taskId);
      }
    }
  }

  mapA2ATaskToRun(taskId: string, runId: number): void {
    this.taskMap.set(taskId, runId);
  }

  getRunIdForA2ATask(taskId: string): number | undefined {
    return this.taskMap.get(taskId);
  }

  deleteA2ATask(taskId: string): void {
    const runId = this.taskMap.get(taskId);
    if (runId !== undefined) {
      this.taskMap.delete(taskId);
    }
    this.snapshots.delete(taskId);
  }

  saveTaskSnapshot(taskId: string, snapshot: Record<string, unknown>): void {
    this.snapshots.set(taskId, snapshot);
  }

  getTaskSnapshot(taskId: string): Record<string, unknown> | undefined {
    return this.snapshots.get(taskId);
  }
}

class TestEventBus implements ExecutionEventBus {
  public events: any[] = [];
  public finishedCalls = 0;

  publish(event: any): void {
    this.events.push(event);
  }

  finished(): void {
    this.finishedCalls += 1;
  }

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }

  once(): this {
    return this;
  }

  removeAllListeners(): this {
    return this;
  }
}

function createMessage(
  taskId: string,
  contextId: string,
  skillId: string | undefined,
  text: string,
): Message {
  return {
    kind: "message",
    messageId: uuidv4(),
    taskId,
    contextId,
    role: "user",
    metadata: skillId ? { skillId } : undefined,
    parts: [{ kind: "text", text }],
  };
}

describe("PocketMeshTaskStore", () => {
  it("saves snapshots and run status", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);

    const runId = persistence.createRun("echo");
    persistence.mapA2ATaskToRun("task-1", runId);

    const task: Task = {
      kind: "task",
      id: "task-1",
      contextId: "ctx-1",
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
      },
      history: [],
      artifacts: [],
      metadata: { skillId: "echo" },
    };

    await taskStore.save(task);

    expect(await taskStore.load("task-1")).toEqual(task);
    expect(persistence.getRun(runId)?.status).toBe("completed");
  });

  it("safely handles missing snapshots and unmapped runs", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);

    expect(await taskStore.load("missing")).toBeUndefined();

    const task: Task = {
      kind: "task",
      id: "task-2",
      contextId: "ctx-2",
      status: {
        state: "rejected",
        timestamp: new Date().toISOString(),
      },
      history: [],
      metadata: {},
    };

    await expect(taskStore.save(task)).resolves.toBeUndefined();
    expect(await taskStore.load("task-2")).toEqual(task);
  });
});

describe("PocketMeshExecutor", () => {
  it("publishes SDK events for a simple flow", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);
    const flowStub: any = {
      onStatusUpdate: undefined,
      onArtifact: undefined,
      runLifecycle: jest.fn(async (shared: any) => {
        const incoming = shared.__a2a_incoming_message as Message;
        const firstText = incoming.parts[0] as { text?: string };
        shared.__a2a_final_response_parts = [
          { kind: "text", text: `Echo: ${firstText.text ?? ""}` },
        ];
      }),
    };

    const executor = new PocketMeshExecutor(
      { echo: flowStub },
      persistence,
      taskStore,
    );

    const taskId = uuidv4();
    const contextId = uuidv4();
    const message: Message = {
      kind: "message",
      messageId: uuidv4(),
      taskId,
      contextId,
      role: "user",
      metadata: { skillId: "echo" },
      parts: [{ kind: "text", text: "hello" }],
    };

    const requestContext = new RequestContext(message, taskId, contextId);
    const eventBus = new TestEventBus();

    await executor.execute(requestContext, eventBus);

    const kinds = eventBus.events.map((event) => event.kind);
    expect(kinds).toContain("task");
    expect(
      eventBus.events.some(
        (event) =>
          event.kind === "message" &&
          event.parts?.[0]?.text === "Echo: hello",
      ),
    ).toBe(true);
    expect(
      eventBus.events.some(
        (event) => event.kind === "status-update" && event.final === true,
      ),
    ).toBe(true);

    const snapshot = await taskStore.load(taskId);
    expect(snapshot?.metadata?.skillId).toBe("echo");
  });

  it("handles flow errors and records failure state", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);
    const flowStub: any = {
      onStatusUpdate: undefined,
      onArtifact: undefined,
      runLifecycle: jest.fn(async () => {
        throw new Error("boom");
      }),
    };

    const executor = new PocketMeshExecutor(
      { echo: flowStub },
      persistence,
      taskStore,
    );

    const taskId = uuidv4();
    const contextId = uuidv4();
    const message = createMessage(taskId, contextId, "echo", "fail please");
    const eventBus = new TestEventBus();
    const requestContext = new RequestContext(message, taskId, contextId);

    await executor.execute(requestContext, eventBus);

    const statusEvents = eventBus.events.filter(
      (event) => event.kind === "status-update",
    );
    const finalStatus = statusEvents[statusEvents.length - 1];
    expect(finalStatus.status.state).toBe("failed");
    expect(finalStatus.final).toBe(true);

    const stored = await taskStore.load(taskId);
    expect(stored?.status.state).toBe("failed");
    const failureTexts =
      stored?.history
        ?.flatMap((msg) =>
          msg.parts
            .filter((part): part is { kind: "text"; text: string } => part.kind === "text")
            .map((part) => part.text),
        ) ?? [];

    expect(failureTexts.some((text) => text.includes("PocketMesh flow failed"))).toBe(true);
  });

  it("normalises artifacts emitted by flows", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);
    const flowStub: any = {
      onStatusUpdate: undefined,
      onArtifact: undefined,
      runLifecycle: jest.fn(async function (this: any, shared: any) {
        shared.lastEcho = "fallback message";
        this.onStatusUpdate?.({
          node: "MockNode",
          state: "working",
          message: "processing",
          step: 0,
          shared,
        });
        this.onArtifact?.({
          parts: [{ type: "text", text: "legacy artifact" }],
        });
      }),
    };

    const executor = new PocketMeshExecutor(
      { echo: flowStub },
      persistence,
      taskStore,
    );

    const taskId = uuidv4();
    const contextId = uuidv4();
    const message = createMessage(taskId, contextId, undefined, "go!");
    const requestContext = new RequestContext(message, taskId, contextId);
    const eventBus = new TestEventBus();

    await executor.execute(requestContext, eventBus);

    const artifactEvent = eventBus.events.find(
      (event) => event.kind === "artifact-update",
    );
    expect(artifactEvent?.artifact.parts[0].kind).toBe("text");

    const finalMessage = eventBus.events.find(
      (event) => event.kind === "message",
    );
    expect(finalMessage?.parts[0].text).toContain("fallback message");
  });

  it("cancels tasks and updates persistence state", async () => {
    const persistence = new TestPersistence();
    const taskStore = new PocketMeshTaskStore(persistence);
    const executor = new PocketMeshExecutor(
      {
        echo: {
          onStatusUpdate: undefined,
          onArtifact: undefined,
          runLifecycle: jest.fn(async () => {}),
        } as any,
      },
      persistence,
      taskStore,
    );

    const taskId = uuidv4();
    const contextId = uuidv4();
    const runId = persistence.createRun("echo");
    persistence.mapA2ATaskToRun(taskId, runId);
    persistence.addStep(runId, "INIT", null, 0, {
      __a2a_history: [],
      __a2a_context_id: contextId,
    });

    const task: Task = {
      kind: "task",
      id: taskId,
      contextId,
      history: [],
      artifacts: [],
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
      metadata: { skillId: "echo" },
    };

    await taskStore.save(task);

    const eventBus = new TestEventBus();
    await executor.cancelTask(taskId, eventBus);

    const updated = await taskStore.load(taskId);
    expect(updated?.status.state).toBe("canceled");
    expect(
      eventBus.events.some(
        (event) =>
          event.kind === "status-update" && event.status.state === "canceled",
      ),
    ).toBe(true);
    expect(persistence.getRun(runId)?.status).toBe("canceled");
  });
});
