import type { SharedState, Params, ActionResult, NodeOptions } from "./types";

/**
 * BaseNode: The fundamental, composable unit of computation in PocketMesh.
 *
 * Nodes are:
 * - Strongly typed (via generics)
 * - Composable (can connect to other nodes via actions)
 * - Support retries, batching, and parallelism via options and method overrides
 *
 * @template S SharedState type
 * @template P Params type
 * @template PrepResult Type returned by prepare()
 * @template ExecResult Type returned by execute()
 * @template Action Type of action result (string or enum)
 */
export abstract class BaseNode<
  S extends SharedState = SharedState,
  P extends Params = Params,
  PrepResult = unknown,
  ExecResult = unknown,
  Action extends ActionResult = ActionResult,
> {
  /**
   * Default parameters for this node (merged with runtime params).
   */
  protected defaultParams: P = {} as P;

  /**
   * Execution options (retries, parallelism, etc).
   */
  public options: NodeOptions = {};

  /**
   * Reference to the parent Flow (set automatically).
   */
   public flow?: import("./flow").Flow<any, any, any, any>;

  /**
   * Successor nodes, keyed by action string.
   */
  private readonly successors: Map<string, BaseNode<any, any, any, any, any>> =
    new Map();

  /**
   * Set default parameters for this node.
   * @param params Default params
   * @returns this
   */
  setParams(params: P): this {
    this.defaultParams = params;
    return this;
  }

  /**
   * Set execution options (retries, parallelism, etc).
   * @param options NodeOptions
   * @returns this
   */
  setOptions(options: NodeOptions): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Add a successor node for a given action.
   * @param node Successor node
   * @param action Action string (default: "default")
   * @returns node
   */
   addSuccessor<N extends BaseNode<any, any, any, any, any>>(
     node: N,
     action: string = "default",
   ): N {
     if (this.successors.has(action)) {
       throw new Error(
         `Successor for action '${action}' already exists in node ${this.constructor.name}.`,
       );
     }
     this.successors.set(action, node);
     return node;
   }

  /**
   * Connect this node to another node for the default action.
   * @param targetNode Node to connect to
   * @returns targetNode
   */
  connectTo<N extends BaseNode<any, any, any, any, any>>(targetNode: N): N {
    return this.addSuccessor(targetNode, "default");
  }

  /**
   * Connect this node to another node for a specific action.
   * @param action Action string
   * @param targetNode Node to connect to
   * @returns targetNode
   */
  connectAction<N extends BaseNode<any, any, any, any, any>>(
    action: string,
    targetNode: N,
  ): N {
    if (!action || typeof action !== "string") {
      throw new TypeError("Action must be a non-empty string");
    }
    return this.addSuccessor(targetNode, action);
  }

  /**
   * Get all successor nodes.
   * @returns ReadonlyMap of successors
   */
  getSuccessors(): ReadonlyMap<string, BaseNode<any, any, any, any, any>> {
    return this.successors;
  }

  // --- Lifecycle methods ---

  /**
   * Prepare any data needed for execution.
   * @param shared Shared state
   * @param params Runtime params
   */
  abstract prepare(shared: S, params: P): Promise<PrepResult>;

  /**
   * Execute the main logic of the node.
   * @param prepResult Result from prepare()
   * @param params Runtime params
   * @param attempt Attempt index (for retries)
   */
  abstract execute(
    prepResult: PrepResult,
    params: P,
    attempt: number,
  ): Promise<ExecResult>;

  /**
   * Finalize after execution, update shared state, and return action.
   * @param shared Shared state
   * @param prepResult Result from prepare()
   * @param execResult Result from execute()
   * @param params Runtime params
   */
  abstract finalize(
    shared: S,
    prepResult: PrepResult,
    execResult: ExecResult,
    params: P,
  ): Promise<Action>;

  /**
   * (Optional) For batch nodes: execute logic for a single item.
   * @param item The item to process
   * @param params Runtime params
   * @param attempt Attempt index (for retries)
   */
  async executeItem?(item: any, params: P, attempt: number): Promise<any>;

  /**
   * (Optional) For batch nodes: fallback logic for a single item.
   * @param item The item to process
   * @param error The error encountered
   * @param params Runtime params
   * @param attempt Attempt index
   */
  async executeItemFallback?(
    item: any,
    error: Error,
    params: P,
    attempt: number,
  ): Promise<any>;

  /**
   * (Optional) For retry nodes: fallback logic for main execution.
   * @param prepResult Result from prepare()
   * @param error The error encountered
   * @param params Runtime params
   * @param attempt Attempt index
   */
  async executeFallback?(
    prepResult: PrepResult,
    error: Error,
    params: P,
    attempt: number,
  ): Promise<ExecResult>;
}