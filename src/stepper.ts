import {
  Flow,
  BaseNode,
  SharedState,
  Params,
  ActionResult,
  toAsyncIterable,
} from "./index";
import { sqlitePersistence, Persistence } from "./utils/persistence";

export interface StepperOptions {
  flowName: string;
  // Update flowFactory to use the more specific generic bounds for SharedState and Params
  flowFactory: () => Flow<any, any, any, any>;
  persistence?: Persistence;
}

export class FlowStepper<
  S extends SharedState = SharedState,
  P extends Params = Params,
> {
  // Use more specific generic bounds for the flow property
  private flow: Flow<S, P, any, any>;
  private runId: number;
  private stepIndex: number;
  private shared: S;
  private params: P;
  private persistence: Persistence;

  constructor(options: StepperOptions, shared?: S, params?: P, runId?: number) {
    // Cast the result of the factory to the stepper's specific flow type if needed, or let TS infer
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
        // Ensure shared state is loaded as the correct type
        this.shared = JSON.parse(lastStep.shared_state_json) as S;
      } else {
        // If runId exists but no steps, it's an inconsistent state. Initialize.
        this.stepIndex = 0;
        this.persistence.addStep(
          this.runId,
          "START",
          null,
          this.stepIndex,
          this.shared,
        );
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
    // Ensure the flow instance inside the stepper has its .flow property set to itself (the stepper manages it)
    // This is slightly different from the Flow.orchestrate setting the parent flow.
    // The stepper itself *is* the orchestrator in this context.
    // We need to call the same `setFlowOnNode` logic as in the Flow constructor.
    (this.flow as Flow<any, any, any, any>).setFlowOnNode(this.flow.startNode); // Set flow property on nodes
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

  /**
   * Executes the next single step (node) in the flow's execution run.
   * Updates the internal shared state and persistence.
   * @returns An object describing the executed node, action taken, and if the flow run is complete.
   * @throws Error if the current node cannot be found or executed.
   */
  async step(): Promise<{
    nodeName: string;
    action: ActionResult;
    done: boolean;
  }> {
    // Find the node to execute based on the last step in the run
    let currentNode: BaseNode<S, P, any, any, ActionResult> | null;
    let lastStep = this.persistence.getLastStep(this.runId);
    let nodeName: string;
    let actionFromLastStep: ActionResult = null; // Action returned by the *previous* node

    if (!lastStep || lastStep.node_name === "START") {
      // Starting the flow - execute the start node
      currentNode = this.flow.startNode;
      if (!currentNode) throw new Error("No start node defined in flow");
      nodeName = currentNode.constructor.name;
      // Action is null initially, as no previous node returned one
      actionFromLastStep = null;
    } else {
      // Continuing the flow - find the node corresponding to the last step's action
      nodeName = lastStep.node_name;
      actionFromLastStep = lastStep.action;
      // Find the node that *executed* in the last step by traversing from start
      const previousNode = this.findNodeByName(
        this.flow.startNode as BaseNode<any, any, any, any, any>,
        nodeName,
      ) as BaseNode<S, P, any, any, ActionResult> | null;

      if (!previousNode) {
        // This indicates a problem with the flow definition or persistence state
        throw new Error(
          `Previous node '${nodeName}' from step index ${lastStep.step_index} not found in flow definition`,
        );
      }

      // Get the next node based on the action returned by the previous node
      currentNode = (this.flow as Flow<any, any, any, any>)["getNextNode"](
        previousNode as BaseNode<any, any, any, any, any>,
        actionFromLastStep,
      ) as BaseNode<S, P, any, any, ActionResult> | null;

      if (!currentNode) {
        // Flow is done because the last node returned an action with no corresponding successor
        this.persistence.updateRunStatus(this.runId, "completed");
        return {
          nodeName: previousNode.constructor.name, // Report the node that finished the flow
          action: actionFromLastStep,
          done: true,
        };
      }
      // If a next node is found, update the nodeName for the current step
      nodeName = currentNode.constructor.name;
    }

    if (!currentNode) {
      // Should not happen if logic is correct, but defensive check
      throw new Error("Could not determine the next node to execute.");
    }

    // --- Execute the current node's lifecycle methods (prepare, execute, finalize) ---
    const finalParams = { ...currentNode["defaultParams"], ...this.params }; // Merge params

    const isBatchNode = typeof currentNode.executeItem === "function"; // Check for batch method
    let actionResult: ActionResult = null; // Action result returned by *this* node
    let prepResult: any = undefined; // Result from prepare
    let execResult: any = undefined; // Result from execute (or array of results for batch)

    try {
      // --- Prepare ---
      prepResult = await currentNode.prepare(this.shared, finalParams);

      if (isBatchNode) {
        // --- Batch/Parallel Execute ---
        const items: any[] = [];
        // Ensure prepare result is iterable and collect items
        for await (const item of toAsyncIterable(prepResult)) items.push(item);

        // Simplified batch/item execution for stepper (no retries/fallback in step)
        // You might want to add retry/fallback logic here for a more robust stepper
        const itemResults: any[] = [];
        for (const item of items) {
          // Call executeItem, passing shared state and params
          itemResults.push(
            await currentNode.executeItem!(item, this.shared, finalParams, 0),
          ); // Pass shared state
        }
        execResult = itemResults; // execResult is array of results for batch

        // --- Finalize (for batch) ---
        actionResult = await currentNode.finalize(
          this.shared, // Pass shared state
          prepResult,
          execResult, // Pass array of results
          finalParams,
        );
      } else {
        // --- Normal Execute ---
        // Call execute, passing shared state and params
        execResult = await currentNode.execute(
          prepResult,
          this.shared,
          finalParams,
          0,
        ); // Pass shared state

        // --- Finalize (for non-batch) ---
        actionResult = await currentNode.finalize(
          this.shared, // Pass shared state
          prepResult,
          execResult, // Pass single result
          finalParams,
        );
      }
    } catch (err) {
      // Catch errors during this step's execution
      console.error(
        `[Stepper] Error executing node ${nodeName} in run ${this.runId} at step ${this.stepIndex + 1}:`,
        err,
      );
      // Mark run as failed
      this.persistence.updateRunStatus(this.runId, "failed");
      // Save a step record indicating failure (optional, but helpful for debugging)
      this.persistence.addStep(
        this.runId,
        nodeName,
        "failed", // Use a special action string for failure
        this.stepIndex + 1,
        this.shared, // Save state at point of failure
      );
      // Re-throw the error so the caller of step() knows it failed
      throw err;
    }

    // --- Save Step ---
    // Increment step index BEFORE saving the step record
    this.stepIndex += 1;
    this.persistence.addStep(
      this.runId,
      nodeName,
      actionResult as string | null, // Save the action returned by the node
      this.stepIndex,
      this.shared, // Save the shared state (potentially modified by finalize)
    );

    // --- Determine if Flow is Done ---
    // Check if the action returned by the *current* node leads to another node
    const nextNode = (this.flow as Flow<any, any, any, any>)["getNextNode"](
      currentNode as BaseNode<any, any, any, any, any>,
      actionResult,
    );

    if (!nextNode) {
      // Flow is done after this step because the action does not map to a successor
      this.persistence.updateRunStatus(this.runId, "completed");
      return { nodeName, action: actionResult, done: true };
    }

    // Flow is not done - there is a next node
    return { nodeName, action: actionResult, done: false };
  }

  // Helper: find node by constructor name (DFS)
  // This helper is internal and used by the stepper to locate nodes from step records.
  // It needs to be a method on FlowStepper, not Flow.
  private findNodeByName(
    node: BaseNode<any, any, any, any, any>,
    name: string,
    visited: Set<BaseNode<any, any, any, any, any>> = new Set(),
  ): BaseNode<any, any, any, any, any> | null {
    if (!node || visited.has(node)) return null;
    if (node.constructor.name === name) return node;
    visited.add(node);
    for (const succ of node.getSuccessors().values()) {
      // Recursively call findNodeByName on successors
      const found = this.findNodeByName(succ, name, visited);
      if (found) return found;
    }
    return null; // Node not found in this branch
  }
}
