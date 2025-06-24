export * from "./types";
export * from "./agentCard";
export * from "./server";
export * from "./client";
export * from "./basenode";

/**
 * Helper to expose PocketMesh flows as an A2A agent.
 * Usage: app.post("/a2a", a2aServerHandler({ flows, agentCard }))
 */
import type { AgentCard } from "./types";
import type { Flow } from "../index";
import { handleA2ARequest } from "./server";
import type { Request, Response } from "express";

export function a2aServerHandler(opts: {
  flows: Record<string, Flow<any, any, any, any>>;
  agentCard: AgentCard;
  persistence?: import("../utils/persistence").Persistence;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await handleA2ARequest(req.body, opts, req, res);
      // Only send JSON if not streaming (streaming handled inside handleA2ARequest)
      if (typeof result !== "undefined") {
        res.json(result);
      }
    } catch (err) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: {
          code: -32603,
          message: "Internal error",
          data: (err as Error).message,
        },
      });
    }
  };
}
