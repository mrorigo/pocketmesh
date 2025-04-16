import { logger } from "./logger";

/**
 * Retry an async function with optional fallback and logging.
 */
export async function retryAsync<T>(
  fn: (attempt: number) => Promise<T>,
  maxRetries: number = 1,
  waitSeconds: number = 0,
  fallback?: (error: Error, attempt: number) => Promise<T>,
  nodeName?: string,
  itemLabel?: string,
): Promise<T> {
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      logger.warn(
        `[${nodeName}]${itemLabel ? ` [${itemLabel}]` : ""} Attempt ${attempt + 1} failed:`,
        (error as Error).message,
      );
      if (attempt === maxRetries - 1) {
        if (fallback) return await fallback(error as Error, attempt);
        throw error;
      }
      if (waitSeconds > 0) await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  throw new Error(
    `retryAsync failed unexpectedly after retries. Last error: ${lastError}`,
  );
}