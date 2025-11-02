import fs from "fs";
import os from "os";
import path from "path";

describe("sqlitePersistence", () => {
  const tmpPath = path.join(
    os.tmpdir(),
    `pocketmesh-test-${Date.now()}-${Math.random()}.sqlite`,
  );

  let persistence: typeof import("../src/utils/persistence")["sqlitePersistence"];

  beforeAll(async () => {
    process.env.POCKETMESH_DB_PATH = tmpPath;
    ({ sqlitePersistence: persistence } = await import("../src/utils/persistence"));
  });

  afterAll(() => {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  });

  it("creates runs, persists steps, and manages task mappings", () => {
    const runId = persistence.createRun("demo");
    expect(persistence.getRun(runId)?.flow_name).toBe("demo");

    persistence.updateRunStatus(runId, "working");
    expect(persistence.getRun(runId)?.status).toBe("working");

    const stepId = persistence.addStep(runId, "NodeA", "default", 0, {
      foo: "bar",
    });
    expect(stepId).toBeGreaterThan(0);
    expect(persistence.getLastStep(runId)?.node_name).toBe("NodeA");

    const taskId = "task-123";
    persistence.mapA2ATaskToRun(taskId, runId);
    expect(persistence.getRunIdForA2ATask(taskId)).toBe(runId);

    persistence.saveTaskSnapshot(taskId, { id: taskId });
    expect(persistence.getTaskSnapshot(taskId)).toEqual({ id: taskId });

    persistence.deleteA2ATask(taskId);
    expect(persistence.getTaskSnapshot(taskId)).toBeUndefined();

    persistence.deleteRun(runId);
    expect(persistence.getRun(runId)).toBeUndefined();
    expect(persistence.getStepsForRun(runId)).toEqual([]);
  });
});
