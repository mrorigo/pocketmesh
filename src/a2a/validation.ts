import { z } from "zod";

// --- Part schemas ---
export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export const FilePartSchema = z.object({
  type: z.literal("file"),
  file: z.object({
    name: z.string().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    bytes: z.string().optional().nullable(),
    uri: z.string().optional().nullable(),
  }),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export const DataPartSchema = z.object({
  type: z.literal("data"),
  data: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export const PartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);

// --- Message schema ---
export const MessageSchema = z.object({
  role: z.enum(["user", "agent"]),
  parts: z.array(PartSchema),
  metadata: z.record(z.unknown()).optional().nullable(),
});

// --- SendTaskRequest schema ---
export const SendTaskRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.literal("tasks/send"),
  params: z.object({
    id: z.string(),
    message: MessageSchema,
    metadata: z.record(z.unknown()).optional().nullable(),
  }),
});

// --- SendTaskStreamingRequest schema ---
export const SendTaskStreamingRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.literal("tasks/sendSubscribe"),
  params: z.object({
    id: z.string(),
    message: MessageSchema,
    metadata: z.record(z.unknown()).optional().nullable(),
  }),
});

// --- GetTaskRequest schema ---
export const GetTaskRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.literal("tasks/get"),
  params: z.object({
    id: z.string(),
    historyLength: z.number().optional().nullable(),
    metadata: z.record(z.unknown()).optional().nullable(),
  }),
});