/**
 * PocketMesh A2A - Barrel export for A2A related types, clients, and server handler.
 * -------------------------------------------------------------------------------
 */

export * from "./types";
export * from "./agentCard";
export * from "./client";

// Import and re-export the main A2A server request handler from the new server module
export { handleA2ARequest } from "./server/handlers";

import type { AgentCard } from "./types";
import type { Flow } from "../core/flow"; // Import Flow type
import { handleA2ARequest as coreHandleA2ARequest } from "./server/handlers"; // Import the core handler with an alias
import type { Request, Response } from "express"; // Import Express types
import { Persistence } from "../utils/persistence";
import { logger } from "../utils/logger";
import { createJsonRpcError } from "./server/utils";

/**
 * Helper to expose PocketMesh flows as an A2A agent via an Express route.
 * Creates an Express middleware function that calls handleA2ARequest.
 * Usage: app.post("/a2a", a2aServerHandler({ flows, agentCard }))
 */
export function a2aServerHandler(opts: {
  flows: Record<string, Flow<any, any, any, any>>;
  agentCard: AgentCard;
  persistence?: Persistence; // Use direct import path for persistence type
}) {
  // Return an Express request handler middleware function
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Call the core A2A request handler, passing Express req/res for streaming
      const result = await coreHandleA2ARequest(req.body, opts, req, res);

      // If the core handler returned a result (i.e., it wasn't a streaming request handled by res), send the JSON response.
      if (typeof result !== "undefined") {
        // Assumes result is a JSON-RPC response object
        res.json(result);
      }
      // If result is undefined, streaming was handled, and res was used inside handleA2ARequest.
    } catch (err) {
      // This catch block primarily handles errors *from this wrapper itself* or
      // errors that weren't caught and formatted into a JSON-RPC error by handleA2ARequest.
      // handleA2ARequest is designed to catch most errors and return a JSON-RPC error result,
      // so this might only catch truly exceptional cases or errors in the setup.
      logger.error("[A2A Server Wrapper] Unhandled error:", {
        requestId: req.body?.id ?? null,
        method: req.body?.method,
        error: err instanceof Error ? err.stack : err,
      });
      // Send a generic 500 Internal Server Error response with a JSON-RPC error payload
      res.status(500).json(
        createJsonRpcError(
          req.body?.id ?? null,
          -32603, // Internal error
          "Internal server error processing A2A request.",
          err instanceof Error ? err.message : String(err), // Include error message
        ),
      );
    }
  };
}
