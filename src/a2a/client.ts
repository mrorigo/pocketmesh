import {
  SendTaskRequest,
  SendTaskResponse,
  Message,
  SendTaskStreamingRequest,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from "./types";

/**
 * Create an A2A client for a remote agent.
 * Streaming (sendSubscribe) is implemented for Node.js using undici.
 */
export function createA2AClient(agentUrl: string) {
  return {
    /**
     * Send a task to the agent (non-streaming).
     */
    async sendTask(
      taskId: string,
      message: Message,
      skillId?: string,
    ): Promise<SendTaskResponse> {
      const req: SendTaskRequest = {
        jsonrpc: "2.0",
        id: taskId,
        method: "tasks/send",
        params: {
          id: taskId,
          message,
          metadata: skillId ? { skillId } : undefined,
        },
      };
      const resp = await fetch(agentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return await resp.json();
    },

    /**
     * Get the status/history of a task.
     */
    async getTask(taskId: string): Promise<any> {
      const req = {
        jsonrpc: "2.0",
        id: taskId,
        method: "tasks/get",
        params: { id: taskId },
      };
      const resp = await fetch(agentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return await resp.json();
    },

    /**
     * Streaming: sendSubscribe (SSE, Node.js only)
     * @param taskId - Unique task ID
     * @param message - Initial user message
     * @param skillId - Optional skill ID
     * @param onEvent - Callback for each SSE event (TaskStatusUpdateEvent or TaskArtifactUpdateEvent)
     * @param onError - Callback for errors
     * @returns a function to close the stream
     *
     * Requires: npm install undici
     */
    sendSubscribe(
      taskId: string,
      message: Message,
      skillId: string | undefined,
      onEvent: (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => void,
      onError?: (err: any) => void,
    ): () => void {
      const { fetch } = require("undici");
      const req: SendTaskStreamingRequest = {
        jsonrpc: "2.0",
        id: taskId,
        method: "tasks/sendSubscribe",
        params: {
          id: taskId,
          message,
          metadata: skillId ? { skillId } : undefined,
        },
      };

      let closed = false;
      const abortController = new (globalThis.AbortController ||
        require("abort-controller"))();

      (async () => {
        try {
          const resp = await fetch(agentUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
            signal: abortController.signal,
          });
          if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          if (!resp.body) throw new Error("No response body for SSE");

          // Parse SSE stream line-by-line
          let buffer = "";
          for await (const chunk of resp.body) {
            const chunkStr = Buffer.from(chunk).toString("utf8");
            buffer += chunkStr;
            let idx;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const rawEvent = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              // Parse SSE event (look for "data: ...")
              const dataLine = rawEvent
                .split("\n")
                .find((line) => line.startsWith("data:"));
              if (dataLine) {
                const json = dataLine.slice(5).trim();
                try {
                  const event = JSON.parse(json);
                  onEvent(event);
                } catch (e) {
                  if (onError) onError(e);
                }
              }
            }
          }
        } catch (err: any) {
          // Suppress AbortError if stream was intentionally closed
          if (!(err && err.name === "AbortError" && closed)) {
            if (onError) onError(err);
          }
        }
      })();

      // Return a function to close the stream
      return () => {
        if (!closed) abortController.abort();
        closed = true;
      };
    },
  };
}
