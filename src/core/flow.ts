import type { SharedState, Params, ActionResult } from "./types";
import { BaseNode } from "./node"; // Keep import for BaseNode
import { retryAsync } from "../utils/retry"; // Keep import for retryAsync
import { logger } from "../utils/logger"; // Keep import for logger
import { toAsyncIterable } from "./utils"; // Keep import for toAsyncIterable

/**
 * Flow: Orchestrates execution of nodes, supports batch/parallel/retry.
 *
 * - Strongly typed and composable
 * - Supports event hooks for streaming/progress (onStatusUpdate, onArtifact)
 * - DRY, extensible, and AI-friendly
 *
 * @template S SharedState type
 * @template P Params type
 * @template StartNode Type of the start node
 * @template Action Type of action result
 */
export class Flow<
  S extends SharedState = SharedState,
  P extends Params = Params,
  StartNode extends BaseNode<S, any, any, any, any> = BaseNode<S>, // Updated generic bounds for shared state
  Action extends ActionResult = ActionResult,
> extends BaseNode<S, P, any, null, Action> {
  /**
   * The start node of the flow.
   */
  public readonly startNode: StartNode;

  /**
   * Event hook: called on status/progress updates.
   */
  public onStatusUpdate?: (status: {
    node: string;
    state: string;
    message?: string;
    step: number;
    totalSteps?: number;
    shared?: S; // Include shared state in status updates if node provides it
  }) => void;

  /**
   * Event hook: called when an artifact is emitted.
   */
  public onArtifact?: (artifact: any) => void; // Use any for flexibility, server handler will validate A2A format

  /**
   * Construct a new Flow.
   * @param startNode The entry node for the flow
   */
  constructor(startNode: StartNode) {
    super();
    if (!startNode) throw new Error("Flow must have a startNode.");
    this.startNode = startNode;
    // Set .flow property on all nodes in the graph
    this.setFlowOnNode(startNode); // Use the new helper
  }

  /**
   * Helper to recursively set the .flow property on a node and its successors.
   * Called during Flow construction or when connecting a new node to an existing flow.
   * @param node The node to start setting the flow property from.
   * @param visited Set of nodes already visited during traversal.
   */
  public setFlowOnNode(
    node: BaseNode<any, any, any, any, any> | null,
    visited: Set<BaseNode<any, any, any, any, any>> = new Set(),
  ): void {
    if (!node || visited.has(node)) return;
    // Cast node to ensure shared state type compatibility if needed, or use 'any'
    node.flow = this as any; // Cast 'this' to any Flow type to avoid strict generic issues here
    visited.add(node);
    // Recursively call for all successors
    for (const succ of node.getSuccessors().values()) {
      this.setFlowOnNode(succ, visited);
    }
  }

  /**
   * Get the next node based on the action result.
   * @param currentNode The current node
   * @param action The action result
   * @returns The next node or null if flow is done
   */
  protected getNextNode(
    currentNode: BaseNode<any, any, any, any, any>,
    action: ActionResult,
  ): BaseNode<any, any, any, any, any> | null {
    // Ensure action is treated as a string key
    const effectiveAction = (action ?? "default") as string;
    const successors = currentNode.getSuccessors();
    const nextNode = successors.get(effectiveAction);
    if (!nextNode && successors.size > 0) {
      const availableActions = Array.from(successors.keys());
      throw new Error(
        `Flow ${this.constructor.name} halting: Action '${effectiveAction}' not found in successors of ${currentNode.constructor.name}. Available: [${availableActions.join(", ")}]`,
      );
    }
    // If no next node and no successors defined, it's a natural end of a branch
    return nextNode || null;
  }

  /**
   * Orchestrate the flow: auto-detect node type and execute accordingly.
   * All user node lifecycle calls are wrapped in try/catch for robust error handling.
   * Errors are logged with full context (node, action, params, stack).
   * @param shared Shared state
   * @param params Runtime params
   */
  protected async orchestrate(shared: S, params: P): Promise<void> {
    let currentNode: BaseNode<S, P, any, any, Action> | null = this.startNode; // Use more specific generic bounds
    let step = 0;
    // TODO: Calculate total steps if needed for onStatusUpdate
    let totalSteps = 0;

    while (currentNode) {
      const nodeToRun: BaseNode<S, P, any, any, Action> = currentNode; // Ensure correct type
      const nodeName = nodeToRun.constructor.name;
      // Merge flow-level default params with node-level default params and runtime params
      const finalParams: P = {
        ...this.defaultParams,
        ...nodeToRun["defaultParams"],
        ...params,
      };

      // Emit status: working on node
      // Pass current shared state to the status update hook
      this.onStatusUpdate?.({
        node: nodeName,
        state: "working",
        message: `Starting node ${nodeName}`,
        step,
        totalSteps,
        shared, // Pass the current shared state
      });

      // Detect batch node by the presence of executeItem method
      const isBatchNode = typeof nodeToRun.executeItem === "function";

      // Detect retry/fallback
      const hasExecuteFallback =
        typeof nodeToRun.executeFallback === "function";
      const hasExecuteItemFallback =
        typeof nodeToRun.executeItemFallback === "function";

      const maxRetries = nodeToRun.options.maxRetries ?? 1;
      const waitSeconds = nodeToRun.options.waitSeconds ?? 0;
      const parallel = nodeToRun.options.parallel ?? false;

      let actionResult: ActionResult;
      let prepResult: any = undefined; // Initialize prepResult outside try for finalize scope

      try {
        // --- 1. Prepare ---
        try {
          prepResult = await nodeToRun.prepare(shared, finalParams);
        } catch (prepErr) {
          logger.error(`[Flow] Error in prepare() of node ${nodeName}`, {
            node: nodeName,
            phase: "prepare",
            params: finalParams,
            error: prepErr instanceof Error ? prepErr.stack : prepErr,
          });
          throw prepErr; // Re-throw the error to be caught by the outer catch block
        }

        if (isBatchNode) {
          // --- Batch or Parallel Batch Node Execution ---
          const items: any[] = [];
          try {
            // Ensure prepResult is iterable and collect items
            for await (const item of toAsyncIterable(prepResult))
              items.push(item);
          } catch (iterErr) {
            logger.error(
              `[Flow] Error iterating items from prepare result in batch node ${nodeName}`,
              {
                node: nodeName,
                phase: "prepare-iterator",
                params: finalParams,
                error: iterErr instanceof Error ? iterErr.stack : iterErr,
              },
            );
            throw iterErr;
          }

          const processItem = async (item: any, idx: number) => {
            // Pass current shared state to the status update hook
            this.onStatusUpdate?.({
              node: nodeName,
              state: "working", // Still working on the node, but refining message
              message: `Processing batch item ${idx + 1}/${items.length}`,
              step,
              totalSteps,
              shared, // Pass the current shared state
            });
            try {
              const result: any = await retryAsync(
                // Pass shared state to executeItem
                (attempt) =>
                  nodeToRun.executeItem!(item, shared, finalParams, attempt), // <-- PASSING SHARED HERE
                maxRetries,
                waitSeconds,
                hasExecuteItemFallback
                  ? (error, attempt) =>
                      // Pass shared state to executeItemFallback
                      nodeToRun.executeItemFallback!(
                        item,
                        error,
                        shared, // <-- PASSING SHARED HERE
                        finalParams,
                        attempt,
                      )
                  : undefined,
                nodeName,
                `item index ${idx}`, // More specific label for item retry logging
              );
              // Check for __a2a_artifact convention on item result
              if (
                result &&
                typeof result === "object" &&
                result !== null &&
                "__a2a_artifact" in result
              ) {
                this.onArtifact?.(
                  (result as { __a2a_artifact: any }).__a2a_artifact,
                );
              }
              return result;
            } catch (itemErr) {
              logger.error(
                `[Flow] Error processing batch item in executeItem() of node ${nodeName}`,
                {
                  node: nodeName,
                  phase: "executeItem",
                  item,
                  params: finalParams,
                  error: itemErr instanceof Error ? itemErr.stack : itemErr,
                },
              );
              throw itemErr; // Re-throw item error
            }
          };

          let results: any[];
          if (parallel) {
            // Parallel processing
            try {
              // Execute all item promises concurrently
              results = await Promise.all(items.map(processItem));
            } catch (parErr) {
              logger.error(
                `[Flow] Error during parallel batch processing in node ${nodeName}`,
                {
                  node: nodeName,
                  phase: "batch-parallel",
                  params: finalParams,
                  error: parErr instanceof Error ? parErr.stack : parErr,
                },
              );
              throw parErr; // Re-throw parallel error
            }
          } else {
            // Sequential processing
            results = [];
            for (let i = 0; i < items.length; ++i) {
              try {
                // Execute items one by one
                results.push(await processItem(items[i], i));
              } catch (seqErr) {
                logger.error(
                  `[Flow] Error during sequential batch processing in node ${nodeName}`,
                  {
                    node: nodeName,
                    phase: "batch-sequential",
                    item: items[i],
                    params: finalParams,
                    error: seqErr instanceof Error ? seqErr.stack : seqErr,
                  },
                );
                throw seqErr; // Re-throw sequential error
              }
            }
          }
          // Pass the array of results to finalize for batch nodes
          actionResult = await nodeToRun.finalize(
            shared,
            prepResult,
            results, // <-- Pass array of results for batch
            finalParams,
          );
        } else {
          // --- Normal Node Execution (non-batch) ---
          let execResult: any = undefined; // Initialize execResult outside try for finalize scope
          try {
            execResult = await retryAsync(
              // Pass shared state to execute
              (attempt) =>
                nodeToRun.execute(prepResult, shared, finalParams, attempt), // <-- PASSING SHARED HERE
              maxRetries,
              waitSeconds,
              hasExecuteFallback
                ? (error, attempt) =>
                    // Pass shared state to executeFallback
                    (nodeToRun as any).executeFallback(
                      prepResult,
                      error,
                      shared, // <-- PASSING SHARED HERE
                      finalParams,
                      attempt,
                    )
                : undefined,
              nodeName,
            );
          } catch (execErr) {
            logger.error(`[Flow] Error in execute() of node ${nodeName}`, {
              node: nodeName,
              phase: "execute",
              params: finalParams,
              error: execErr instanceof Error ? execErr.stack : execErr,
            });
            throw execErr; // Re-throw execution error
          }

          // Check for __a2a_artifact convention on single execute result
          if (
            execResult &&
            typeof execResult === "object" &&
            execResult !== null &&
            "__a2a_artifact" in execResult
          ) {
            this.onArtifact?.(
              (execResult as { __a2a_artifact: any }).__a2a_artifact,
            );
          }

          // Pass the single execution result to finalize
          actionResult = await nodeToRun.finalize(
            shared,
            prepResult,
            execResult, // <-- Pass single result for non-batch
            finalParams,
          );
        }
      } catch (err) {
        // Catch any error from prepare, execute, executeItem, fallbacks, iteration, or finalize
        // Emit status: failed before re-throwing
        // Pass current shared state to the status update hook
        this.onStatusUpdate?.({
          node: nodeName,
          state: "failed",
          message: `Node ${nodeName} failed: ${err instanceof Error ? err.message : String(err)}`,
          step,
          totalSteps,
          shared, // Pass the current shared state
        });
        // Log the unhandled error with context
        logger.error(`[Flow] Unhandled error in node ${nodeName}`, {
          node: nodeName,
          params: finalParams,
          shared: { ...shared }, // Log a copy of shared state to avoid excessive logging if it's huge
          error: err instanceof Error ? err.stack : err,
        });
        throw err; // Re-throw the error to be handled by the outer wrapper (e.g., A2A server)
      }

      // Emit status: node completed (successfully)
      // Pass current shared state to the status update hook
      this.onStatusUpdate?.({
        node: nodeName,
        state: "completed", // Indicates node finished its execution successfully
        message: `Node ${nodeName} completed`,
        step,
        totalSteps, // TODO: Set totalSteps if calculable
        shared, // Pass the current shared state
      });

      currentNode = this.getNextNode(nodeToRun, actionResult);
      step++;
    }

    // Emit final flow completion status if the flow reached a terminal node without error
    // Pass current shared state to the status update hook
    this.onStatusUpdate?.({
      node: "Flow", // Special node name for flow status
      state: "completed",
      message: "Flow execution finished successfully.",
      step, // Final step count
      totalSteps,
      shared, // Pass the current shared state
    });
  }

  /**
   * Flows cannot be executed directly.
   * This method always throws. It exists only because Flow extends BaseNode.
   * @param prepResult Result from prepare() (will be undefined for Flow)
   * @param shared Shared state
   * @param params Runtime params
   * @param attempt Attempt index
   */
  override async execute(
    prepResult: any,
    shared: S,
    params: P,
    attempt: number,
  ): Promise<null> {
    // This method should never be called on a Flow instance.
    // The orchestrate method is the main execution logic for a Flow.
    throw new Error(`Flow (${this.constructor.name}) cannot execute directly.`);
  }

  /**
   * Run the full flow lifecycle (prepare, orchestrate, finalize).
   * This is the main entry point to start a flow execution.
   * @param shared Shared state (will be modified in place)
   * @param params Optional runtime params
   * @returns Final action result returned by the last node's finalize method, or "default" if the flow completes normally.
   */
  async runLifecycle(shared: S, params?: P): Promise<Action> {
    const finalParams = { ...this.defaultParams, ...(params || {}) }; // Merge flow default params with provided params

    // --- 1. Flow Prepare ---
    // Note: Flow's prepare is called once before orchestration begins
    let flowPrepResult: any = undefined;
    try {
      flowPrepResult = await this.prepare(shared, finalParams);
    } catch (prepErr) {
      logger.error(
        `[Flow] Error in Flow.prepare() for ${this.constructor.name}`,
        {
          phase: "flow-prepare",
          params: finalParams,
          shared: { ...shared },
          error: prepErr instanceof Error ? prepErr.stack : prepErr,
        },
      );
      // Re-throw so the caller (e.g., A2A server handler) can catch and handle
      throw prepErr;
    }

    // --- 2. Orchestrate Nodes ---
    // The main execution loop, modifying 'shared' in place.
    // Errors from node execution are caught and logged within orchestrate, then re-thrown.
    await this.orchestrate(shared, finalParams);

    // --- 3. Flow Finalize ---
    // Called after orchestration completes (successfully or with an error re-thrown and caught outside)
    let finalActionResult: Action = undefined as Action; // Default to undefined action if finalize is missing
    try {
      finalActionResult = await this.finalize(
        shared,
        flowPrepResult, // Pass result from Flow.prepare
        null, // Pass null as execResult for Flow finalize
        finalParams,
      );
      logger.log(
        `[Flow] Flow.finalize() completed for ${this.constructor.name}`,
      );
    } catch (finErr) {
      logger.error(
        `[Flow] Error in Flow.finalize() for ${this.constructor.name}`,
        {
          phase: "flow-finalize",
          params: finalParams,
          shared: { ...shared },
          error: finErr instanceof Error ? finErr.stack : finErr,
        },
      );
      // Re-throw so the caller (e.g., A2A server handler) can catch and handle
      throw finErr;
    }

    // Return the action result from the Flow's finalize (if implemented)
    return (finalActionResult ?? "default") as Action; // Default to "default" if finalize doesn't return one
  }

  /**
   * Default prepare implementation for the Flow itself (no-op).
   * Override in subclasses if the overall flow needs initial setup.
   * @param shared Shared state
   * @param params Runtime params
   */
  async prepare(_shared: S, _params: P): Promise<any> {
    return undefined;
  }

  /**
   * Default finalize implementation for the Flow itself (no-op).
   * Override in subclasses if the overall flow needs cleanup or final action determination.
   * @param shared Shared state
   * @param flowPrepResult Result from Flow.prepare()
   * @param _execResult Always null for Flow finalize
   * @param params Runtime params
   */
  async finalize(
    _shared: S,
    flowPrepResult: any,
    _execResult: null,
    _params: P,
  ): Promise<Action> {
    // Default implementation returns undefined action, which resolves to "default"
    return undefined as Action;
  }
}
