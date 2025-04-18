/**
 * PocketMesh - Barrel export for all core types and classes.
 * ----------------------------------------------------------
 * This file re-exports all core abstractions from src/core/.
 * All framework logic lives in src/core/.
 */

export * from "./core";
export {
  a2aServerHandler,
  createA2AClient,
  generateAgentCard,
  handleA2ARequest,
} from "./a2a";
