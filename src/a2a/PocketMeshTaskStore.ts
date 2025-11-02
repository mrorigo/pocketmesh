import type { TaskStore } from "@a2a-js/sdk/server";
import type { Task, TaskState } from "./types";
import type { Persistence } from "../utils/persistence";

/**
 * PocketMeshTaskStore bridges the generic A2A TaskStore interface with
 * PocketMesh's existing persistence layer. Tasks are cached in SQLite-backed
 * snapshots so DefaultRequestHandler can load/resume them, while run-level
  metadata is kept in the existing runs/steps tables.
 */
export class PocketMeshTaskStore implements TaskStore {
  constructor(private readonly persistence: Persistence) {}

  async save(task: Task): Promise<void> {
    this.persistence.saveTaskSnapshot(task.id, task as unknown as Record<string, unknown>);

    const runId = this.persistence.getRunIdForA2ATask(task.id);
    if (runId !== undefined) {
      this.persistence.updateRunStatus(runId, this.mapStateToRunStatus(task.status.state));
    }
  }

  async load(taskId: string): Promise<Task | undefined> {
    const snapshot = this.persistence.getTaskSnapshot(taskId);
    if (!snapshot) return undefined;
    return snapshot as unknown as Task;
  }

  private mapStateToRunStatus(state: TaskState): string {
    switch (state) {
      case "submitted":
        return "submitted";
      case "working":
        return "working";
      case "input-required":
        return "input-required";
      case "completed":
        return "completed";
      case "canceled":
        return "canceled";
      case "failed":
        return "failed";
      case "rejected":
        return "rejected";
      case "auth-required":
        return "auth-required";
      default:
        return "unknown";
    }
  }
}
