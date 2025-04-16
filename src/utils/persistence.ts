import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * Persistence interface for dependency injection.
 */
export interface Persistence {
  createRun(flowName: string): number;
  getRun(runId: number): RunRecord | undefined;
  updateRunStatus(runId: number, status: string): void;
  addStep(
    runId: number,
    nodeName: string,
    action: string | null,
    stepIndex: number,
    sharedState: object
  ): number;
  getStepsForRun(runId: number): StepRecord[];
  getLastStep(runId: number): StepRecord | undefined;
  getStepByIndex(runId: number, stepIndex: number): StepRecord | undefined;
  deleteRun(runId: number): void;
  mapA2ATaskToRun(taskId: string, runId: number): void;
  getRunIdForA2ATask(taskId: string): number | undefined;
  deleteA2ATask(taskId: string): void;
}

export interface RunRecord {
  id: number;
  flow_name: string;
  created_at: string;
  status: string;
}

export interface StepRecord {
  id: number;
  run_id: number;
  node_name: string;
  action: string | null;
  step_index: number;
  shared_state_json: string;
  created_at: string;
}

/**
 * Default SQLite persistence implementation.
 */
const DB_PATH = process.env.POCKETMESH_DB_PATH || path.join(process.cwd(), "pocketmesh.sqlite");

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, "");
}

const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  node_name TEXT NOT NULL,
  action TEXT,
  step_index INTEGER NOT NULL,
  shared_state_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS a2a_tasks (
  task_id TEXT PRIMARY KEY,
  run_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

export const sqlitePersistence: Persistence = {
  createRun(flowName: string): number {
    const stmt = db.prepare("INSERT INTO runs (flow_name) VALUES (?)");
    const info = stmt.run(flowName);
    return info.lastInsertRowid as number;
  },
  getRun(runId: number): RunRecord | undefined {
    return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRecord | undefined;
  },
  updateRunStatus(runId: number, status: string) {
    db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, runId);
  },
  addStep(
    runId: number,
    nodeName: string,
    action: string | null,
    stepIndex: number,
    sharedState: object
  ): number {
    const stmt = db.prepare(
      "INSERT INTO steps (run_id, node_name, action, step_index, shared_state_json) VALUES (?, ?, ?, ?, ?)"
    );
    const info = stmt.run(
      runId,
      nodeName,
      action,
      stepIndex,
      JSON.stringify(sharedState)
    );
    return info.lastInsertRowid as number;
  },
  getStepsForRun(runId: number): StepRecord[] {
    return db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC").all(runId) as StepRecord[];
  },
  getLastStep(runId: number): StepRecord | undefined {
    return db.prepare(
      "SELECT * FROM steps WHERE run_id = ? ORDER BY step_index DESC LIMIT 1"
    ).get(runId) as StepRecord | undefined;
  },
  getStepByIndex(runId: number, stepIndex: number): StepRecord | undefined {
    return db.prepare(
      "SELECT * FROM steps WHERE run_id = ? AND step_index = ?"
    ).get(runId, stepIndex) as StepRecord | undefined;
  },
  deleteRun(runId: number) {
    db.prepare("DELETE FROM steps WHERE run_id = ?").run(runId);
    db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    db.prepare("DELETE FROM a2a_tasks WHERE run_id = ?").run(runId);
  },
  mapA2ATaskToRun(taskId: string, runId: number) {
    db.prepare("INSERT OR REPLACE INTO a2a_tasks (task_id, run_id) VALUES (?, ?)").run(taskId, runId);
  },
  getRunIdForA2ATask(taskId: string): number | undefined {
    const row = db.prepare("SELECT run_id FROM a2a_tasks WHERE task_id = ?").get(taskId) as { run_id: number } | undefined;
    return row ? row.run_id : undefined;
  },
  deleteA2ATask(taskId: string) {
    db.prepare("DELETE FROM a2a_tasks WHERE task_id = ?").run(taskId);
  }
};