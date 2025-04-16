import type { SharedState, Params, ActionResult } from "./types";
import { BaseNode } from "./node";
import { retryAsync } from "../utils/retry";
import { logger } from "../utils/logger";

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
  StartNode extends BaseNode<S, any, any, any, any> = BaseNode<S>,
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
    shared?: S;
  }) => void;

  /**
   * Event hook: called when an artifact is emitted.
   */
  public onArtifact?: (artifact: any) => void;

  /**
   * Construct a new Flow.
   * @param startNode The entry node for the flow
   */
  constructor(startNode: StartNode) {
    super();
    if (!startNode) throw new Error("Flow must have a startNode.");
    this.startNode = startNode;
    // Set .flow property on all nodes in the graph
    const setFlow = (
      node: BaseNode<any, any, any, any, any>,
      flow: Flow<any, any, any, any>,
      visited: Set<BaseNode<any, any, any, any, any>> = new Set(),
    ) => {
      if (!node || visited.has(node)) return;
      node.flow = flow;
      visited.add(node);
      for (const succ of node.getSuccessors().values()) {
        setFlow(succ, flow, visited);
      }
    };
    setFlow(startNode, this);
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
     const effectiveAction = (action ?? "default") as string;
     const successors = currentNode.getSuccessors();
     const nextNode = successors.get(effectiveAction);
     if (!nextNode && successors.size > 0) {
       const availableActions = Array.from(successors.keys());
       throw new Error(
         `Flow ${this.constructor.name} halting: Action '${effectiveAction}' not found in successors of ${currentNode.constructor.name}. Available: [${availableActions.join(", ")}]`,
       );
     }
     return nextNode || null;
   }

  /**
   * Orchestrate the flow: auto-detect node type and execute accordingly.
   * @param shared Shared state
   * @param params Runtime params
   */
  /**
   * Orchestrate the flow: auto-detect node type and execute accordingly.
   * All user node lifecycle calls are wrapped in try/catch for robust error handling.
   * Errors are logged with full context (node, action, params, stack).
   */
  protected async orchestrate(shared: S, params: P): Promise<void> {
    let currentNode: BaseNode<any, any, any, any, any> | null = this.startNode;
    let step = 0;
    let totalSteps = 0;
    while (currentNode) {
      const nodeToRun = currentNode;
      const nodeName = nodeToRun.constructor.name;
      const finalParams = { ...nodeToRun["defaultParams"], ...params };

      // Emit status: working on node
      this.onStatusUpdate?.({
        node: nodeName,
        state: "working",
        step,
        totalSteps,
        shared,
      });

      // Detect batch node
      const isBatchNode = typeof (nodeToRun.executeItem) === "function";

      // Detect retry/fallback
      const hasExecuteFallback =
        typeof (nodeToRun.executeFallback) === "function";
      const hasExecuteItemFallback =
        typeof (nodeToRun.executeItemFallback) === "function";

      const maxRetries = nodeToRun.options.maxRetries ?? 1;
      const waitSeconds = nodeToRun.options.waitSeconds ?? 0;
      const parallel = nodeToRun.options.parallel ?? false;

      let actionResult: ActionResult;

      try {
        if (isBatchNode) {
          // Batch or Parallel Batch Node
          let prepResult: any;
          try {
            prepResult = await nodeToRun.prepare(shared, finalParams);
          } catch (prepErr) {
            logger.error(
              `[Flow] Error in prepare() of batch node ${nodeName}`,
              {
                node: nodeName,
                phase: "prepare",
                params: finalParams,
                error: prepErr instanceof Error ? prepErr.stack : prepErr,
              },
            );
            throw prepErr;
          }
          const items: any[] = [];
          try {
            for await (const item of prepResult) items.push(item);
          } catch (iterErr) {
            logger.error(
              `[Flow] Error iterating items in batch node ${nodeName}`,
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
            this.onStatusUpdate?.({
              node: nodeName,
              state: "working",
              message: `Processing batch item ${idx + 1}/${items.length}`,
              step,
              totalSteps,
              shared,
            });
            try {
              const result: any = await retryAsync(
                (attempt) =>
                  nodeToRun.executeItem!(item, finalParams, attempt),
                maxRetries,
                waitSeconds,
                hasExecuteItemFallback
                  ? (error, attempt) =>
                      nodeToRun.executeItemFallback!(
                        item,
                        error,
                        finalParams,
                        attempt,
                      )
                  : undefined,
                nodeName,
                JSON.stringify(item),
              );
              if (result && result.__a2a_artifact) {
                this.onArtifact?.(result.__a2a_artifact);
              }
              return result;
            } catch (itemErr) {
              logger.error(
                `[Flow] Error in executeItem() of batch node ${nodeName}`,
                {
                  node: nodeName,
                  phase: "executeItem",
                  item,
                  params: finalParams,
                  error: itemErr instanceof Error ? itemErr.stack : itemErr,
                },
              );
              throw itemErr;
            }
          };

          let results: any[];
          if (parallel) {
            try {
              results = await Promise.all(items.map(processItem));
            } catch (parErr) {
              logger.error(
                `[Flow] Error in parallel batch processing in node ${nodeName}`,
                {
                  node: nodeName,
                  phase: "batch-parallel",
                  params: finalParams,
                  error: parErr instanceof Error ? parErr.stack : parErr,
                },
              );
              throw parErr;
            }
          } else {
            results = [];
            for (let i = 0; i < items.length; ++i) {
              try {
                results.push(await processItem(items[i], i));
              } catch (seqErr) {
                logger.error(
                  `[Flow] Error in sequential batch processing in node ${nodeName}`,
                  {
                    node: nodeName,
                    phase: "batch-sequential",
                    item: items[i],
                    params: finalParams,
                    error: seqErr instanceof Error ? seqErr.stack : seqErr,
                  },
                );
                throw seqErr;
              }
            }
          }
          try {
            actionResult = await nodeToRun.finalize(
              shared,
              prepResult,
              results,
              finalParams,
            );
          } catch (finErr) {
            logger.error(
              `[Flow] Error in finalize() of batch node ${nodeName}`,
              {
                node: nodeName,
                phase: "finalize",
                params: finalParams,
                error: finErr instanceof Error ? finErr.stack : finErr,
              },
            );
            throw finErr;
          }
        } else {
          // Normal Node (with optional retry/fallback)
          let prepResult: any;
          try {
            prepResult = await nodeToRun.prepare(shared, finalParams);
          } catch (prepErr) {
            logger.error(`[Flow] Error in prepare() of node ${nodeName}`, {
              node: nodeName,
              phase: "prepare",
              params: finalParams,
              error: prepErr instanceof Error ? prepErr.stack : prepErr,
            });
            throw prepErr;
          }
          let execResult: any;
          try {
            execResult = await retryAsync(
              (attempt) => nodeToRun.execute(prepResult, finalParams, attempt),
              maxRetries,
              waitSeconds,
              hasExecuteFallback
                ? (error, attempt) =>
                    (nodeToRun as any).executeFallback(
                      prepResult,
                      error,
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
            throw execErr;
          }
          if (execResult && typeof execResult === "object" && execResult !== null && "__a2a_artifact" in execResult) {
            this.onArtifact?.((execResult as { __a2a_artifact: any }).__a2a_artifact);
          }
          try {
            actionResult = await nodeToRun.finalize(
              shared,
              prepResult,
              execResult,
              finalParams,
            );
          } catch (finErr) {
            logger.error(`[Flow] Error in finalize() of node ${nodeName}`, {
              node: nodeName,
              phase: "finalize",
              params: finalParams,
              error: finErr instanceof Error ? finErr.stack : finErr,
            });
            throw finErr;
          }
        }
      } catch (err) {
        logger.error(`[Flow] Unhandled error in node ${nodeName}`, {
          node: nodeName,
          params: finalParams,
          shared,
          error: err instanceof Error ? err.stack : err,
        });
        throw err;
      }

      // Emit status: node completed
      this.onStatusUpdate?.({
        node: nodeName,
        state: "completed",
        step,
        totalSteps,
        shared,
      });

      currentNode = this.getNextNode(nodeToRun, actionResult);
      step++;
    }
  }

  /**
   * Flows cannot be executed directly.
   * This method always throws.
   */
  override async execute(prepResult: any, params: P): Promise<null> {
    throw new Error(`Flow (${this.constructor.name}) cannot execute directly.`);
  }

  /**
   * Run the full flow lifecycle (prepare, orchestrate, finalize).
   * @param shared Shared state
   * @param params Runtime params
   * @returns Final action result
   */
  async runLifecycle(shared: S, params?: P): Promise<Action> {
    const finalParams = { ...this.defaultParams, ...(params || {}) };
    const prepResult = await this.prepare(shared, finalParams);
    await this.orchestrate(shared, finalParams);
    const actionResult = await this.finalize(
      shared,
      prepResult,
      null,
      finalParams,
    );
    return (actionResult ?? "default") as Action;
  }

  /**
   * Default prepare implementation (no-op).
   * Override in subclasses if needed.
   */
  async prepare(_shared: S, _params: P): Promise<any> {
    return undefined;
  }

  /**
   * Default finalize implementation (no-op).
   * Override in subclasses if needed.
   */
  async finalize(
    _shared: S,
    _prep: any,
    _execResult: any,
    _params: P,
  ): Promise<Action> {
    return undefined as Action;
  }
}
