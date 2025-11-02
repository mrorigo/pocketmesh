import { Flow } from "../src/core/flow";
import { BaseNode } from "../src/core/node";
import type { SharedState, Params } from "../src/core/types";
import { logger } from "../src/utils/logger";

class NoopNode extends BaseNode<SharedState, Params, void, string, string> {
  async prepare(): Promise<void> {}

  async execute(): Promise<string> {
    return "ok";
  }

  async finalize(shared: SharedState): Promise<string> {
    shared.noopFinalized = true;
    return "default";
  }
}

describe("Flow branch coverage", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    jest.spyOn(logger, "error").mockImplementation(() => {});
    jest.spyOn(logger, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws when successor action is missing", () => {
    const first = new NoopNode();
    const second = new NoopNode();
    first.connectTo(second);
    const flow = new Flow(first);

    expect(() => (flow as any).getNextNode(first, "missing")).toThrow(
      "Action 'missing' not found",
    );
  });

  it("invokes executeFallback and emits artifacts", async () => {
    class FallbackNode extends BaseNode<
      SharedState,
      Params,
      void,
      { __a2a_artifact?: any },
      string
    > {
      async prepare(): Promise<void> {}

      async execute(): Promise<{ __a2a_artifact: any }> {
        throw new Error("boom");
      }

      async executeFallback(): Promise<{ __a2a_artifact: any }> {
        return {
          __a2a_artifact: {
            artifactId: "a1",
            parts: [{ kind: "text", text: "from fallback" }],
          },
        };
      }

      async finalize(
        shared: SharedState,
        _prep: void,
        execResult: { __a2a_artifact: any },
      ): Promise<string> {
        shared.finalArtifact = execResult.__a2a_artifact;
        return "default";
      }
    }

    const node = new FallbackNode();
    node.setOptions({ maxRetries: 1 });
    const flow = new Flow(node);
    const statusSpy = jest.fn();
    const artifactSpy = jest.fn();
    flow.onStatusUpdate = statusSpy;
    flow.onArtifact = artifactSpy;

    const shared: SharedState = {};
    await expect(flow.runLifecycle(shared, {} as Params)).resolves.toBe("default");

    expect(artifactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "a1" }),
    );
    expect(
      statusSpy.mock.calls.some(
        ([update]) =>
          update.node === "FallbackNode" && update.state === "working",
      ),
    ).toBe(true);
    const finalArtifact = shared.finalArtifact as {
      parts: Array<{ text: string }>;
    };
    expect(finalArtifact.parts[0].text).toBe("from fallback");
  });

  it("executes batch items in parallel and uses item fallback", async () => {
    class ParallelBatchNode extends BaseNode<
      SharedState,
      Params,
      number[],
      Array<{ value: number }>,
      string
    > {
      async prepare(): Promise<number[]> {
        return [1, 2];
      }

      async execute(): Promise<Array<{ value: number }>> {
        throw new Error("should not be called");
      }

      async executeItem(): Promise<{ value: number }> {
        throw new Error("item failure");
      }

      async executeItemFallback(
        item: number,
      ): Promise<{ value: number }> {
        return { value: item * 10 };
      }

      async finalize(
        shared: SharedState,
        _prep: number[],
        execResult: Array<{ value: number }>,
      ): Promise<string> {
        shared.batchResults = execResult;
        return "done";
      }
    }

    const node = new ParallelBatchNode();
    node.setOptions({ maxRetries: 1, parallel: true });
    const flow = new Flow(node);
    const statusSpy = jest.fn();
    flow.onStatusUpdate = statusSpy;

    const shared: SharedState = {};
    await flow.runLifecycle(shared, {} as Params);

    expect(shared.batchResults).toEqual([
      { value: 10 },
      { value: 20 },
    ]);
    expect(
      statusSpy.mock.calls.some(
        ([update]) =>
          update.message && update.message.includes("Processing batch item"),
      ),
    ).toBe(true);
  });

  it("emits failure status when prepare throws", async () => {
    class PrepareErrorNode extends BaseNode<
      SharedState,
      Params,
      void,
      string,
      string
    > {
      async prepare(): Promise<void> {
        throw new Error("prepare busted");
      }

      async execute(): Promise<string> {
        return "ignored";
      }

      async finalize(): Promise<string> {
        return "default";
      }
    }

    const node = new PrepareErrorNode();
    const flow = new Flow(node);
    const statusSpy = jest.fn();
    flow.onStatusUpdate = statusSpy;

    await expect(
      flow.runLifecycle({}, {} as Params),
    ).rejects.toThrow("prepare busted");
    expect(
      statusSpy.mock.calls.some(
        ([update]) =>
          update.node === "PrepareErrorNode" && update.state === "failed",
      ),
    ).toBe(true);
  });

  it("throws when Flow.prepare fails", async () => {
    class PrepareFailFlow extends Flow<
      SharedState,
      Params,
      string,
      NoopNode
    > {
      async prepare(): Promise<any> {
        throw new Error("flow prepare fail");
      }
    }

    const flow = new PrepareFailFlow(new NoopNode());
    await expect(
      flow.runLifecycle({}, {} as Params),
    ).rejects.toThrow("flow prepare fail");
  });

  it("throws when Flow.finalize fails", async () => {
    class FinalizeFailFlow extends Flow<
      SharedState,
      Params,
      string,
      NoopNode
    > {
      async finalize(): Promise<string> {
        throw new Error("flow finalize fail");
      }
    }

    const flow = new FinalizeFailFlow(new NoopNode());
    await expect(
      flow.runLifecycle({}, {} as Params),
    ).rejects.toThrow("flow finalize fail");
  });

  it("Flow.execute always throws", async () => {
    const flow = new Flow(new NoopNode());
    await expect(
      flow.execute(undefined, {} as SharedState, {} as Params, 0),
    ).rejects.toThrow("cannot execute directly");
  });
});
