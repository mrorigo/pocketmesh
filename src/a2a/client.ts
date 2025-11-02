import { A2AClient, type A2AClientOptions } from "@a2a-js/sdk/client";

export { A2AClient } from "@a2a-js/sdk/client";
export type { A2AClientOptions } from "@a2a-js/sdk/client";

/**
 * Factory helper kept for backward compatibility. Returns the official
 * SDK client initialised from a remote agent card URL.
 */
export async function createA2AClient(
  agentUrl: string,
  options?: A2AClientOptions,
): Promise<A2AClient> {
  return A2AClient.fromCardUrl(agentUrl, options);
}
