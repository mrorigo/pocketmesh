/**
 * Example Usage of Simplified PocketFlow Framework
 * ------------------------------------------------
 * Demonstrates parallel fetching, batch processing, and flow orchestration.
 */

import {
  ActionKey,
  ActionResult,
  BaseNode,
  Flow,
  Params,
  SharedState,
  sleep,
} from "../index";

// --- Type Definitions ---
type ItemParams = { itemId: string };
type ItemResult = { data: string };
type ProcessParams = { processMode: "fast" | "slow" };

// --- Utility Function ---
const fakeApiCall = async (data: any, failRate: number = 0): Promise<any> => {
  await sleep(Math.random() * 50 + 10);
  if (Math.random() < failRate) throw new Error("Simulated API failure");
  return { success: true, received: data };
};

// --- Node Definitions ---

class FetchItemNode extends BaseNode<
  SharedState,
  Params,
  void,
  ItemResult,
  ActionResult
> {
  async prepare(_shared: SharedState, _params: Params): Promise<void> {
    // No preparation needed for this node
    return;
  }
  async execute(
    _prep: void,
    _shared: SharedState,
    params: Params,
    attempt: number = 0,
  ): Promise<ItemResult> {
    const typedParams = params as ItemParams;
    const id = typedParams.itemId || "unknown";
    console.log(` Fetching item: ${id} (Attempt: ${attempt + 1})`);
    const result = await fakeApiCall({ id }, 0.4);
    return { data: `ItemData[${id}] Result: ${JSON.stringify(result)}` };
  }
  async finalize(
    shared: SharedState,
    _prep: void,
    execResult: ItemResult,
    params: Params,
  ): Promise<ActionResult> {
    // Do not push to shared.items here; handled in flow
    return ActionKey.Default;
  }
  async executeFallback(
    _prep: void,
    error: Error,
    _shared: SharedState,
    params: Params,
    attempt: number,
  ): Promise<ItemResult> {
    const typedParams = params as ItemParams;
    const id = typedParams.itemId || "unknown";
    console.warn(
      ` Fetch fallback for item ${id} on attempt ${attempt + 1}: ${error.message}`,
    );
    return { data: `FallbackData[${id}]` };
  }
}

class ProcessItemsNode extends BaseNode<
  SharedState,
  Params,
  string[],
  string[],
  ActionResult
> {
  async prepare(shared: SharedState, params: Params): Promise<string[]> {
    const typedParams = params as ProcessParams;
    const items = (shared.items ?? []) as string[];
    console.log(
      ` Prepare Processing (Mode: ${typedParams.processMode}): Found ${items.length} items.`,
    );
    return items;
  }
  // Required abstract method for non-batch nodes (not used here, but must be present)
  async execute(
    _prep: string[],
    _shared: SharedState,
    _params: Params,
    _attempt: number = 0,
  ): Promise<string[]> {
    // Not used, as this is a batch node (uses executeItem)
    throw new Error("Not used in batch node");
  }
  async executeItem(
    item: string,
    _shared: SharedState,
    params: Params,
    attempt: number,
  ): Promise<string> {
    const typedParams = params as ProcessParams;
    console.log(
      `   Processing item: ${item.substring(0, 30)}... (Attempt: ${attempt + 1})`,
    );
    await sleep(typedParams.processMode === "slow" ? 50 : 15);
    if (item.includes("FAIL") || item.includes("Fallback")) {
      throw new Error("Intentional processing failure");
    }
    return `PROCESSED[${item.substring(0, 20)}]`;
  }
  async executeItemFallback(
    item: string,
    error: Error,
    _shared: SharedState,
    params: Params,
    attempt: number,
  ): Promise<string> {
    const typedParams = params as ProcessParams;
    console.warn(
      `   Fallback processing item: ${item.substring(0, 30)}... on attempt ${attempt + 1}. Error: ${error.message}`,
    );
    return `FAILED_PROCESSING[${item.substring(0, 20)}]`;
  }
  async finalize(
    shared: SharedState,
    _prep: string[],
    execResultList: string[],
    _params: Params,
  ): Promise<ActionResult> {
    shared.processedItems = execResultList;
    console.log(
      ` Post Processing: Stored ${execResultList.length} processed results.`,
    );
    return execResultList.length > 0 ? "finalize" : "empty";
  }
}

class FinalizeNode extends BaseNode<SharedState, Params, string[], string, ActionResult> {
  async prepare(shared: SharedState, _params: Params): Promise<string[]> {
    return (shared.processedItems ?? []) as string[];
  }
  async execute(
    processedItems: string[],
    _shared: SharedState,
    _params: Params,
    _attempt: number = 0,
  ): Promise<string> {
    console.log(` Finalizing report for ${processedItems.length} items.`);
    const successCount = processedItems.filter((s) =>
      s.startsWith("PROCESSED"),
    ).length;
    const failedCount = processedItems.length - successCount;
    return `Final Report: ${processedItems.length} items attempted. Success: ${successCount}, Failed: ${failedCount}.`;
  }
  async finalize(
    shared: SharedState,
    _prep: string[],
    execResult: string,
    _params: Params,
  ): Promise<ActionResult> {
    shared.report = execResult;
    console.log(` Report generated: "${execResult}"`);
    return ActionKey.Default;
  }
}

class HandleEmptyNode extends BaseNode<SharedState, Params, void, void, ActionResult> {
  async prepare(_shared: SharedState, _params: Params): Promise<void> {
    return;
  }
  async execute(
    _prep: void,
    _shared: SharedState,
    _params: Params,
    _attempt: number = 0,
  ): Promise<void> {
    console.warn(" Handling empty batch or processing result.");
  }
  async finalize(
    _shared: SharedState,
    _prep: void,
    _execResult: void,
    _params: Params,
  ): Promise<ActionResult> {
    return ActionKey.Default;
  }
}

// --- Flow Definition ---

class FetchBatchFlow extends Flow<
  SharedState,
  Params,
  ActionResult,
  BaseNode<SharedState, Params, void, ItemResult, ActionResult>
> {
  async prepare(_shared: SharedState, _params: Params): Promise<ItemParams[]> {
    const itemIds = ["A-101", "B-202", "C-303", "D-404", "E-FAIL-505"];
    console.log(
      `\nFlow Prep: Preparing parallel fetch for IDs: ${itemIds.join(", ")}`,
    );
    return itemIds.map((id) => ({ itemId: id }));
  }
  async finalize(
    shared: SharedState,
    _prep: unknown,
    _execResult: null,
    _params: Params,
  ): Promise<ActionResult> {
    if (shared.items && Array.isArray(shared.items)) {
      (shared.items as string[]).sort();
    }
    console.log(
      `Flow Post: Parallel fetches completed. Collected ${Array.isArray(shared.items) ? shared.items.length : 0} results.`,
    );
    return Array.isArray(shared.items) && shared.items.length > 0
      ? "process_results"
      : "empty_batch";
  }
  // The orchestrator will auto-detect batch/parallel/retry based on node options and methods.
}

// --- Main Execution ---

async function main() {
  const shared: SharedState = { items: [], processedItems: [], report: null };

  // Create node instances with declarative options
  const fetcher = new FetchItemNode().setOptions({
    maxRetries: 3,
    waitSeconds: 0.1,
    parallel: true,
  });
  const processor = new ProcessItemsNode()
    .setOptions({ maxRetries: 3, waitSeconds: 0.1, parallel: false })
    .setParams({ processMode: "fast" });
  const finalizer = new FinalizeNode();
  const emptyHandler = new HandleEmptyNode();

  // Create the batch flow instance
  const batchFlow = new FetchBatchFlow(fetcher);

  // Connect flow actions
  batchFlow.connectAction("process_results", processor);
  batchFlow.connectAction("empty_batch", emptyHandler);

  processor.connectAction("finalize", finalizer);
  processor.connectAction("empty", emptyHandler);

  // Master flow can also have default parameters
  const masterFlow = new Flow(batchFlow).setParams({ globalSetting: "xyz" });

  console.log("--- Starting Async Native Flow (Simplified API) ---");
  try {
    await masterFlow.runLifecycle(shared, { processMode: "slow" });

    console.log("\n--- Flow Completed ---");
  } catch (e) {
    console.error("\n--- Flow Failed ---", e);
  } finally {
    console.log("\nFinal Shared State:", JSON.stringify(shared, null, 2));
  }
}

main();
