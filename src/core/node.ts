import { Flow } from "./flow"; // Keep import for Flow
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
  // Changed type annotation to allow Flow<S, P, any, any> for better type hints if possible, but kept any for compatibility
  public flow?: Flow<S, P, any, Action>;

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
  addSuccessor<N extends BaseNode<any, any, any, any, any>>( // Keep generics for flexibility
    node: N,
    action: string = "default",
  ): N {
    if (this.successors.has(action)) {
      throw new Error(
        `Successor for action '${action}' already exists in node ${this.constructor.name}.`,
      );
    }
    this.successors.set(action, node);
    // If adding a successor to a node that is already part of a flow,
    // propagate the flow reference to the new node and its downstream nodes.
    if (this.flow) {
      // Cast this.flow to a more general type if necessary for the helper call
      (this.flow as Flow<any, any, any, any>).setFlowOnNode(node);
    }
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
   * This is called once per node execution before execute.
   * @param shared Shared state
   * @param params Runtime params
   */
  abstract prepare(shared: S, params: P): Promise<PrepResult>;

  /**
   * Execute the main logic of the node.
   * This is called zero or more times (depending on batching/retries) after prepare.
   * @param prepResult Result from prepare()
   * @param shared Shared state // <-- ADDED shared
   * @param params Runtime params
   * @param attempt Attempt index (0 for first try)
   */
  abstract execute(
    prepResult: PrepResult,
    shared: S, // <-- ADDED shared state parameter
    params: P,
    attempt: number,
  ): Promise<ExecResult>;

  /**
   * Finalize after execution. Update shared state, and determine the next action.
   * This is called once per node execution after execute (or executeItem batch).
   * @param shared Shared state (potentially modified by execute)
   * @param prepResult Result from prepare()
   * @param execResult Result from execute() (or array of results for batch nodes)
   * @param params Runtime params
   */
  abstract finalize(
    shared: S,
    prepResult: PrepResult,
    execResult: ExecResult, // Note: For batch nodes, this is ExecResult[]
    params: P,
  ): Promise<Action>;

  /**
   * (Optional) For batch nodes: execute logic for a single item.
   * This is called for each item after prepare and before finalize.
   * @param item The item to process (from prepare result)
   * @param shared Shared state // <-- ADDED shared
   * @param params Runtime params
   * @param attempt Attempt index (0 for first try)
   */
  async executeItem?(
    item: any,
    shared: S,
    params: P,
    attempt: number,
  ): Promise<any>; // <-- ADDED shared

  /**
   * (Optional) For batch nodes: fallback logic for a single item.
   * Called if `executeItem` fails after retries.
   * @param item The item being processed
   * @param error The error encountered
   * @param shared Shared state // <-- ADDED shared
   * @param params Runtime params
   * @param attempt Attempt index of the failed execution
   */
  async executeItemFallback?(
    item: any,
    error: Error,
    shared: S, // <-- ADDED shared
    params: P,
    attempt: number,
  ): Promise<any>;

  /**
   * (Optional) Fallback logic for main execution (`execute`).
   * Called if `execute` fails after retries (for non-batch nodes).
   * @param prepResult Result from prepare()
   * @param error The error encountered
   * @param shared Shared state // <-- ADDED shared
   * @param params Runtime params
   * @param attempt Attempt index of the failed execution
   */
  async executeFallback?(
    prepResult: PrepResult,
    error: Error,
    shared: S, // <-- ADDED shared
    params: P,
    attempt: number,
  ): Promise<ExecResult>;
}
