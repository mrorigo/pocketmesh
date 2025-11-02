import { v4 as uuidv4 } from "uuid";
import {
  A2AError,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import type { Flow } from "../core/flow";
import type { Persistence } from "../utils/persistence";
import { logger } from "../utils/logger";
import type {
  A2ASharedState,
  Artifact,
  Message,
  Part,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  TextPart,
} from "./types";
import { PocketMeshTaskStore } from "./PocketMeshTaskStore";

type FlowRegistry = Record<string, Flow<any, any, any, any>>;

interface ExecutionState {
  runId: number;
  flow: Flow<any, any, any, any>;
  shared: A2ASharedState;
  history: Message[];
  skillId: string;
  isNew: boolean;
}

export class PocketMeshExecutor implements AgentExecutor {
  constructor(
    private readonly flows: FlowRegistry,
    private readonly persistence: Persistence,
    private readonly taskStore: PocketMeshTaskStore,
  ) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const taskId = requestContext.task?.id ?? requestContext.taskId;
    const contextId = requestContext.contextId;
    const incomingMessage = requestContext.userMessage;
    const skillId = this.resolveSkillId(incomingMessage, requestContext.task);
    const flow = this.flows[skillId];

    if (!flow) {
      throw A2AError.invalidParams(
        `Skill '${skillId}' is not registered on this PocketMesh agent.`,
      );
    }

    const state = this.initializeState(
      taskId,
      contextId,
      skillId,
      incomingMessage,
      flow,
    );

    const collectedArtifacts: Artifact[] =
      Array.isArray(state.shared.__a2a_artifacts)
        ? [...(state.shared.__a2a_artifacts as Artifact[])]
        : [];

    const initialTask = this.buildTaskSnapshot(
      taskId,
      contextId,
      state.shared,
      state.history,
      collectedArtifacts,
      {
        state: state.isNew ? "submitted" : "working",
      },
      skillId,
    );

    await this.taskStore.save(initialTask);
    eventBus.publish(initialTask);

    try {
      this.attachFlowHooks(
        flow,
        eventBus,
        taskId,
        contextId,
        skillId,
        state.shared,
        collectedArtifacts,
      );

      await flow.runLifecycle(state.shared, {} as any);

      const finalMessage = this.buildAgentMessage(
        contextId,
        taskId,
        this.resolveFinalParts(state.shared),
      );

      const historyWithFinal = this.appendMessageIfNew(
        state.history,
        finalMessage,
      );
      state.shared.__a2a_history = historyWithFinal;

      const finalTask = this.buildTaskSnapshot(
        taskId,
        contextId,
        state.shared,
        historyWithFinal,
        collectedArtifacts,
        {
          state: "completed",
          message: finalMessage,
        },
        skillId,
      );

      await this.taskStore.save(finalTask);
      this.persistFinalState(state.runId, state.shared, "completed");

      eventBus.publish(finalTask);
      eventBus.publish(finalMessage);
      eventBus.publish(this.buildFinalStatusEvent(taskId, contextId, finalTask));
    } catch (err) {
      logger.error("[PocketMeshExecutor] Flow execution failed.", {
        error: err instanceof Error ? err.stack : err,
        taskId,
        contextId,
      });

      const errorMessage = this.buildAgentMessage(contextId, taskId, [
        {
          kind: "text",
          text:
            err instanceof Error
              ? `PocketMesh flow failed: ${err.message}`
              : "PocketMesh flow failed with an unknown error.",
        },
      ]);

      const historyWithError = this.appendMessageIfNew(
        state.history,
        errorMessage,
      );
      state.shared.__a2a_history = historyWithError;

      const failedTask = this.buildTaskSnapshot(
        taskId,
        contextId,
        state.shared,
        historyWithError,
        collectedArtifacts,
        {
          state: "failed",
          message: errorMessage,
        },
        skillId,
      );

      await this.taskStore.save(failedTask);
      this.persistFinalState(state.runId, state.shared, "failed");

      eventBus.publish(failedTask);
      eventBus.publish(errorMessage);
      eventBus.publish(this.buildFinalStatusEvent(taskId, contextId, failedTask));
    } finally {
      flow.onStatusUpdate = undefined;
      flow.onArtifact = undefined;
      eventBus.finished();
    }
  }

  async cancelTask(
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const task = await this.taskStore.load(taskId);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    const runId = this.persistence.getRunIdForA2ATask(taskId);
    if (runId !== undefined) {
      const lastStep = this.persistence.getLastStep(runId);
      if (lastStep) {
        const shared = JSON.parse(lastStep.shared_state_json) as A2ASharedState;
        shared.__a2a_history = task.history ?? shared.__a2a_history ?? [];
        shared.__a2a_artifacts = task.artifacts ?? shared.__a2a_artifacts ?? [];
        shared.__a2a_incoming_message =
          shared.__a2a_incoming_message ?? task.history?.slice(-1)[0];
        shared.__a2a_context_id =
          shared.__a2a_context_id ?? task.contextId ?? undefined;
        shared.__a2a_task_id = taskId;
        this.persistFinalState(runId, shared, "canceled");
      } else {
        this.persistence.updateRunStatus(runId, "canceled");
      }
    }

    const canceledTask: Task = {
      ...task,
      status: {
        ...task.status,
        state: "canceled",
        timestamp: new Date().toISOString(),
      },
    };

    await this.taskStore.save(canceledTask);
    eventBus.publish(canceledTask);
    eventBus.publish({
      kind: "status-update",
      taskId: canceledTask.id,
      contextId: canceledTask.contextId,
      status: canceledTask.status,
      final: true,
    });
    eventBus.finished();
  }

  private resolveSkillId(message: Message, existingTask?: Task): string {
    const metadataSkill =
      typeof message.metadata?.skillId === "string"
        ? message.metadata.skillId
        : undefined;
    const taskSkill =
      typeof existingTask?.metadata?.skillId === "string"
        ? (existingTask.metadata.skillId as string)
        : undefined;

    const skillId =
      metadataSkill ??
      taskSkill ??
      Object.keys(this.flows)[0] ??
      this.throwNoSkillError();

    return skillId;
  }

  private throwNoSkillError(): never {
    throw A2AError.internalError(
      "No skills are registered with this PocketMesh A2A server.",
    );
  }

  private initializeState(
    taskId: string,
    contextId: string,
    skillId: string,
    incoming: Message,
    flow: Flow<any, any, any, any>,
  ): ExecutionState {
    let runId = this.persistence.getRunIdForA2ATask(taskId);
    let shared: A2ASharedState = {};
    let history: Message[] = [];
    let isNew = false;

    if (runId === undefined) {
      isNew = true;
      runId = this.persistence.createRun(skillId);
      this.persistence.mapA2ATaskToRun(taskId, runId);
      history = [incoming];
    } else {
      const lastStep = this.persistence.getLastStep(runId);
      if (lastStep) {
        shared = JSON.parse(lastStep.shared_state_json) as A2ASharedState;
        history = Array.isArray(shared.__a2a_history)
          ? [...(shared.__a2a_history as Message[])]
          : [];
      }
      history = this.appendMessageIfNew(history, incoming);
    }

    shared.__a2a_context_id = contextId;
    shared.__a2a_task_id = taskId;
    shared.__a2a_skill_id = skillId;
    shared.__a2a_incoming_message = incoming;
    shared.__a2a_history = history;
    shared.__a2a_artifacts = shared.__a2a_artifacts ?? [];
    shared.input = this.getFirstText(incoming);

    if (isNew) {
      this.persistence.addStep(runId, "A2A_INIT", null, 0, shared);
    }

    return { runId, flow, shared, history, skillId, isNew };
  }

  private attachFlowHooks(
    flow: Flow<any, any, any, any>,
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    skillId: string,
    shared: A2ASharedState,
    collectedArtifacts: Artifact[],
  ) {
    flow.onStatusUpdate = (status) => {
      const event: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: this.buildWorkingStatus(
          taskId,
          contextId,
          status.message ?? undefined,
        ),
        final: false,
        metadata: {
          node: status.node,
          step: status.step,
          totalSteps: status.totalSteps,
        },
      };
      eventBus.publish(event);
    };

    flow.onArtifact = (artifact: unknown) => {
      const artifactLike = artifact as Partial<Artifact>;
      if (!artifactLike || !Array.isArray(artifactLike.parts)) {
        logger.warn(
          "[PocketMeshExecutor] Ignoring malformed artifact emitted by flow.",
          artifactLike,
        );
        return;
      }

      const normalizedArtifact = this.normalizeArtifact(artifactLike);
      collectedArtifacts.push(normalizedArtifact);
      shared.__a2a_artifacts = collectedArtifacts;

      const event: TaskArtifactUpdateEvent = {
        kind: "artifact-update",
        taskId,
        contextId,
        artifact: normalizedArtifact,
      };
      eventBus.publish(event);
    };
  }

  private buildWorkingStatus(
    taskId: string,
    contextId: string,
    message?: string,
  ): TaskStatus {
    return {
      state: "working",
      message: message
        ? this.buildAgentMessage(contextId, taskId, [
            { kind: "text", text: message },
          ])
        : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private getFirstText(message: Message): string | undefined {
    const part = message.parts.find(
      (p): p is TextPart => p.kind === "text",
    );
    return part?.text;
  }

  private normalizeArtifact(artifact: Partial<Artifact>): Artifact {
    const parts = (artifact.parts ?? []).map((part) => this.normalizePart(part));
    return {
      artifactId: artifact.artifactId ?? uuidv4(),
      name: artifact.name,
      description: artifact.description,
      metadata: artifact.metadata ?? {},
      parts,
    };
  }

  private normalizePart(part: any): Part {
    if (part && typeof part === "object") {
      if ("kind" in part) {
        return part as Part;
      }
      if ("type" in part) {
        switch (part.type) {
          case "text":
            return {
              kind: "text",
              text: part.text ?? "",
              metadata: part.metadata ?? {},
            };
          case "data":
            return {
              kind: "data",
              data:
                typeof part.data === "object" && part.data !== null
                  ? part.data
                  : {},
              metadata: part.metadata ?? {},
            };
          case "file":
            return {
              kind: "file",
              file: part.file
                ? part.file
                : part.bytes
                  ? {
                      bytes: part.bytes,
                      mimeType: part.mimeType,
                      name: part.name,
                    }
                  : {
                      uri:
                        typeof part.uri === "string"
                          ? part.uri
                          : "data:application/octet-stream;base64,",
                      mimeType: part.mimeType,
                      name: part.name,
                    },
              metadata: part.metadata ?? {},
            };
          default:
            break;
        }
      }
    }

    return {
      kind: "data",
      data: { value: part },
    };
  }

  private buildAgentMessage(
    contextId: string,
    taskId: string,
    parts: Part[],
  ): Message {
    return {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      contextId,
      taskId,
      parts: parts.map((part) => this.normalizePart(part)),
    };
  }

  private resolveFinalParts(shared: A2ASharedState): Part[] {
    if (
      shared.__a2a_final_response_parts &&
      Array.isArray(shared.__a2a_final_response_parts)
    ) {
      return shared.__a2a_final_response_parts.map((part) =>
        this.normalizePart(part),
      );
    }

    if (shared.lastEcho && typeof shared.lastEcho === "string") {
      return [{ kind: "text", text: shared.lastEcho }];
    }

    return [{ kind: "text", text: "Flow completed." }];
  }

  private appendMessageIfNew(history: Message[], message: Message): Message[] {
    const existing = history[history.length - 1];
    if (
      !existing ||
      existing.messageId !== message.messageId ||
      existing.role !== message.role ||
      JSON.stringify(existing.parts) !== JSON.stringify(message.parts)
    ) {
      return [...history, message];
    }
    return history;
  }

  private buildTaskSnapshot(
    taskId: string,
    contextId: string,
    shared: A2ASharedState,
    history: Message[],
    artifacts: Artifact[],
    status: Partial<TaskStatus> & { state: TaskState },
    skillId: string,
  ): Task {
    const message = status.message;
    const taskStatus: TaskStatus = {
      state: status.state,
      message,
      timestamp: status.timestamp ?? new Date().toISOString(),
    };

    return {
      kind: "task",
      id: taskId,
      contextId,
      history,
      artifacts,
      status: taskStatus,
      metadata: { skillId },
    };
  }

  private persistFinalState(
    runId: number,
    shared: A2ASharedState,
    status: string,
  ) {
    const lastStep = this.persistence.getLastStep(runId);
    const nextStepIndex = lastStep ? lastStep.step_index + 1 : 1;
    this.persistence.updateRunStatus(runId, status);
    this.persistence.addStep(
      runId,
      status === "completed" ? "A2A_FINAL" : "A2A_ERROR",
      status,
      nextStepIndex,
      shared,
    );
  }

  private buildFinalStatusEvent(
    taskId: string,
    contextId: string,
    task: Task,
  ): TaskStatusUpdateEvent {
    return {
      kind: "status-update",
      taskId,
      contextId,
      status: task.status,
      final: true,
    };
  }
}
