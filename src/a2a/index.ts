/**
 * PocketMesh A2A - Barrel export for A2A related types, clients, and server helpers.
 * ----------------------------------------------------------------------------------
 */

import type {
  Express,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import {
  DefaultRequestHandler,
  type AgentExecutor,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";

import { sqlitePersistence, type Persistence } from "../utils/persistence";
import type { Flow } from "../core/flow";
import type { AgentCard } from "./types";
import { PocketMeshTaskStore } from "./PocketMeshTaskStore";
import { PocketMeshExecutor } from "./PocketMeshExecutor";

export * from "./types";
export * from "./agentCard";
export * from "./client";
export { PocketMeshTaskStore } from "./PocketMeshTaskStore";
export { PocketMeshExecutor } from "./PocketMeshExecutor";

export interface A2AServerOptions {
  flows: Record<string, Flow<any, any, any, any>>;
  agentCard: AgentCard;
  persistence?: Persistence;
  taskStore?: PocketMeshTaskStore;
  executorFactory?: (
    flows: Record<string, Flow<any, any, any, any>>,
    persistence: Persistence,
    taskStore: PocketMeshTaskStore,
  ) => AgentExecutor;
}

export interface PocketMeshA2AServer {
  taskStore: PocketMeshTaskStore;
  executor: AgentExecutor;
  requestHandler: DefaultRequestHandler;
  expressApp: A2AExpressApp;
}

export function createPocketMeshA2AServer(
  options: A2AServerOptions,
): PocketMeshA2AServer {
  const persistence = options.persistence ?? sqlitePersistence;
  const taskStore =
    options.taskStore ?? new PocketMeshTaskStore(persistence);
  const executor =
    options.executorFactory?.(options.flows, persistence, taskStore) ??
    new PocketMeshExecutor(options.flows, persistence, taskStore);

  const requestHandler = new DefaultRequestHandler(
    options.agentCard,
    taskStore,
    executor,
  );

  const expressApp = new A2AExpressApp(requestHandler);

  return { taskStore, executor, requestHandler, expressApp };
}

/**
 * Helper to register PocketMesh flows as an A2A-compatible Express application.
 * Usage (breaking change): `a2aServerHandler(opts)(app, "/a2a")`
 */
export function a2aServerHandler(options: A2AServerOptions) {
  const server = createPocketMeshA2AServer(options);
  return (
    app: Express,
    baseUrl = "/a2a",
    middlewares?: Array<RequestHandler | ErrorRequestHandler>,
    agentCardPath?: string,
  ) => server.expressApp.setupRoutes(app, baseUrl, middlewares, agentCardPath);
}
