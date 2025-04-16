/**
 * Core utilities for PocketMesh.
 * Exported via the core barrel for use in flows, nodes, and demos.
 */

export enum ActionKey {
  Default = "default",
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function* toAsyncIterable<T>(
  source: AsyncIterable<T> | Iterable<T>,
): AsyncIterable<T> {
  if (typeof (source as any)[Symbol.asyncIterator] === "function") {
    for await (const item of source as AsyncIterable<T>) {
      yield item;
    }
  } else {
    for (const item of source as Iterable<T>) {
      yield item;
    }
  }
}
