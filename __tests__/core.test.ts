/**
 * PocketMesh Core Test Suite
 * --------------------------
 * Tests core orchestration: BaseNode, Flow, batch, and retry logic.
 * Run with: npm test
 */

import { Flow, BaseNode, SharedState, Params, ActionResult } from "../src/core";
import { retryAsync } from "../src/utils/retry";

describe("PocketMesh Core", () => {
  /** Simple node that echoes input */
  class EchoNode extends BaseNode<SharedState, Params, string, string, string> {
    async prepare(shared: SharedState, params: Params): Promise<string> {
      return params.input as string;
    }
    async execute(input: string): Promise<string> {
      return `Echo: ${input}`;
    }
    async finalize(
      shared: SharedState,
      _prep: string,
      execResult: string,
      _params: Params,
    ): Promise<string> {
      shared.lastEcho = execResult;
      return "default"; // or return null;
    }
  }

  it("runs a single-node flow", async () => {
    const node = new EchoNode();
    const flow = new Flow(node);
    const shared: SharedState = {};
    await flow.runLifecycle(shared, { input: "hello" });
    expect(shared.lastEcho).toBe("Echo: hello");
  });

  /** Multi-node flow: Echo -> Uppercase */
  class UpperNode extends BaseNode<
    SharedState,
    Params,
    string,
    string,
    string
  > {
    async prepare(shared: SharedState): Promise<string> {
      return shared.lastEcho as string;
    }
    async execute(input: string): Promise<string> {
      return input.toUpperCase();
    }
    async finalize(
      shared: SharedState,
      _prep: string,
      execResult: string,
    ): Promise<string> {
      shared.upper = execResult;
      return "default"; // or return null;
    }
  }

  it("runs a multi-node flow", async () => {
    const echo = new EchoNode();
    const upper = new UpperNode();
    echo.connectTo(upper);
    const flow = new Flow(echo);
    const shared: SharedState = {};
    await flow.runLifecycle(shared, { input: "mesh" });
    expect(shared.lastEcho).toBe("Echo: mesh");
    expect(shared.upper).toBe("ECHO: MESH");
  });

  /** Batch node: squares numbers */
  class SquareBatchNode extends BaseNode<
    SharedState,
    Params,
    number[],
    number[],
    string
  > {
    async prepare(_shared: SharedState, params: Params): Promise<number[]> {
      return params.numbers as number[];
    }
    // Dummy execute to satisfy abstract contract (not used for batch nodes)
    async execute(): Promise<number[]> {
      throw new Error("Not used in batch node");
    }
    async executeItem(item: number): Promise<number> {
      return item * item;
    }
    async finalize(
      shared: SharedState,
      _prep: number[],
      execResult: number[],
    ): Promise<string> {
      shared.squares = execResult;
      return "done";
    }
  }

  it("runs a batch node flow", async () => {
    const batch = new SquareBatchNode();
    const flow = new Flow(batch);
    const shared: SharedState = {};
    await flow.runLifecycle(shared, { numbers: [2, 3, 4] });
    expect(shared.squares).toEqual([4, 9, 16]);
  });

  /** Retry node: fails first, then succeeds */
  class FlakyNode extends BaseNode<SharedState, Params, void, string, string> {
    private attempts = 0;
    async prepare(): Promise<void> {}
    async execute(): Promise<string> {
      this.attempts++;
      if (this.attempts < 2) throw new Error("Flaky error");
      return "ok";
    }
    async finalize(
      shared: SharedState,
      _prep: void,
      execResult: string,
    ): Promise<string> {
      shared.flaky = execResult;
      return "done";
    }
    async executeFallback(_prep: void, error: Error): Promise<string> {
      return "fallback";
    }
  }

  it("retries and succeeds", async () => {
    const node = new FlakyNode();
    node.setOptions({ maxRetries: 2 });
    const flow = new Flow(node);
    const shared: SharedState = {};
    await flow.runLifecycle(shared, {});
    expect(shared.flaky).toBe("ok");
  });

  it("calls fallback after max retries", async () => {
    class AlwaysFailNode extends FlakyNode {
      async execute(): Promise<string> {
        throw new Error("Always fails");
      }
    }
    const node = new AlwaysFailNode();
    node.setOptions({ maxRetries: 2 });
    const flow = new Flow(node);
    const shared: SharedState = {};
    await flow.runLifecycle(shared, {});
    expect(shared.flaky).toBe("fallback");
  });

  it("retryAsync utility works", async () => {
    let tries = 0;
    const result = await retryAsync(
      async (attempt) => {
        tries++;
        if (attempt < 2) throw new Error("fail");
        return "success";
      },
      3,
      0,
      async () => "fallback",
    );
    expect(result).toBe("success");
    expect(tries).toBe(3);
  });
});
