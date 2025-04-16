import { Flow, BaseNode, SharedState, Params, ActionResult, toAsyncIterable } from "./index";
import { sqlitePersistence, Persistence } from "./utils/persistence";

export interface StepperOptions {
  flowName: string;
  flowFactory: () => Flow<any, any, any, any>;
  persistence?: Persistence;
}

export class FlowStepper<
  S extends SharedState = SharedState,
  P extends Params = Params,
> {
  private flow: Flow<S, P, any, any>;
  private runId: number;
  private stepIndex: number;
  private shared: S;
  private params: P;
  private persistence: Persistence;

  constructor(options: StepperOptions, shared?: S, params?: P, runId?: number) {
    this.flow = options.flowFactory();
    this.shared = shared ?? ({} as S);
    this.params = params ?? ({} as P);
    this.persistence = options.persistence ?? sqlitePersistence;
    if (runId) {
      this.runId = runId;
      // Load last step
      const lastStep = this.persistence.getLastStep(runId);
      if (lastStep) {
        this.stepIndex = lastStep.step_index;
        this.shared = JSON.parse(lastStep.shared_state_json);
      } else {
        this.stepIndex = 0;
      }
    } else {
      this.runId = this.persistence.createRun(options.flowName);
      this.stepIndex = 0;
      // Save initial state
      this.persistence.addStep(
        this.runId,
        "START",
        null,
        this.stepIndex,
        this.shared,
      );
    }
  }

  getRunId(): number {
    return this.runId;
  }

  getCurrentStepIndex(): number {
    return this.stepIndex;
  }

  getSharedState(): S {
    return this.shared;
  }

  // Step through one node; returns { nodeName, action, done }
  async step(): Promise<{
    nodeName: string;
    action: ActionResult;
    done: boolean;
  }> {
    // Find current node
    let currentNode: BaseNode<any, any, any, any, any> | null;
    let lastStep = this.persistence.getLastStep(this.runId);
    let nodeName: string;
    let action: ActionResult = null;

    if (!lastStep || lastStep.node_name === "START") {
      currentNode = this.flow.startNode;
      if (!currentNode) throw new Error("No start node in flow");
      nodeName = currentNode.constructor.name;
    } else {
      // Find node by name in flow
      nodeName = lastStep.node_name;
      action = lastStep.action;
      // Find the node in the flow by traversing from start
      currentNode = this.findNodeByName(this.flow.startNode, nodeName);
      if (!currentNode) throw new Error(`Node ${nodeName} not found in flow`);
      // Get next node based on action
      const nextNode = this.flow["getNextNode"](currentNode, action);
      if (!nextNode) {
        // Flow is done
        this.persistence.updateRunStatus(this.runId, "completed");
        return { nodeName, action, done: true };
      }
      currentNode = nextNode;
      nodeName = currentNode.constructor.name;
    }

    if (!currentNode) throw new Error("Current node is null after resolution");

    // Run node lifecycle (prepare, execute, finalize) for this node only
    const finalParams = { ...currentNode["defaultParams"], ...this.params };
    const isBatchNode = typeof (currentNode.executeItem) === "function";
    let actionResult: ActionResult;

    if (isBatchNode) {
      const prepResult = await currentNode.prepare(this.shared, finalParams);
      const items: any[] = [];
      for await (const item of toAsyncIterable(prepResult)) items.push(item);

      const results: any[] = [];
      for (const item of items) {
        results.push(await currentNode.executeItem!(item, finalParams, 0));
      }
      actionResult = await currentNode.finalize(
        this.shared,
        prepResult,
        results,
        finalParams
      );
    } else {
      const prepResult = await currentNode.prepare(this.shared, finalParams);
      const execResult = await currentNode.execute(prepResult, finalParams, 0);
      actionResult = await currentNode.finalize(
        this.shared,
        prepResult,
        execResult,
        finalParams
      );
    }

    // Save step
    this.stepIndex += 1;
    this.persistence.addStep(
      this.runId,
      nodeName,
      actionResult as string | null,
      this.stepIndex,
      this.shared
    );

    // Check if next node exists
    const nextNode = this.flow["getNextNode"](currentNode, actionResult);
    if (!nextNode) {
      this.persistence.updateRunStatus(this.runId, "completed");
      return { nodeName, action: actionResult, done: true };
    }
    return { nodeName, action: actionResult, done: false };
  }

  // Helper: find node by constructor name (DFS)
  private findNodeByName(
    node: BaseNode<any, any, any, any, any>,
    name: string,
    visited: Set<BaseNode<any, any, any, any, any>> = new Set(),
  ): BaseNode<any, any, any, any, any> | null {
    if (!node || visited.has(node)) return null;
    if (node.constructor.name === name) return node;
    visited.add(node);
    for (const succ of node.getSuccessors().values()) {
      const found = this.findNodeByName(succ, name, visited);
      if (found) return found;
    }
    return null;
  }
}
