/**
 * Core Types for PocketMesh
 */

export type SharedState = Record<string, unknown>;
export type Params = Record<string, unknown>;
export type ActionResult = string | undefined | null;

export interface NodeOptions {
  maxRetries?: number;
  waitSeconds?: number;
  parallel?: boolean;
}

export interface Logger {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}
