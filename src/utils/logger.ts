import type { Logger } from "../core/types";
import winston from "winston";

/**
 * Winston-based logger for production-grade logging.
 * - Supports log levels, timestamps, and structured output.
 * - Logs to console by default; can be extended with file or remote transports.
 */
const winstonLogger = winston.createLogger({
  level: process.env.POCKETMESH_LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
      return `[PocketMesh][${level.toUpperCase()}] ${timestamp} ${message} ${metaStr}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

export const logger: Logger = {
  debug: (...args: any[]) => winstonLogger.debug(args.map(String).join(" ")),
  log: (...args: any[]) => winstonLogger.info(args.map(String).join(" ")),
  error: (...args: any[]) => winstonLogger.error(args.map(String).join(" ")),
  warn: (...args: any[]) => winstonLogger.warn(args.map(String).join(" ")),
};
