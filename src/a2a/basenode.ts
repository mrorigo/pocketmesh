import { BaseNode, Params, ActionResult } from "../core";
import type {
  Message,
  Part,
  DataPart,
  Artifact,
  FilePart,
  FileContent,
  A2ASharedState,
  TextPart,
} from "./types";
import { isDataPart } from "./types"; // Import type guard

/**
 * Base class for PocketMesh nodes designed to operate within an A2A flow context.
 * It extends `BaseNode` and provides convenience methods for accessing A2A-specific
 * inputs from the `shared` state (like the incoming message parts) and for
 * setting A2A-specific outputs (like the final response parts or artifacts),
 * as well as creating A2A-specific part types.
 *
 * Nodes inheriting from this class should call these protected helper methods
 * from within their `prepare`, `execute`, or `finalize` implementations,
 * passing the `shared` state object received by those methods.
 *
 * Your custom shared state interface should extend `A2ASharedState` when using this class,
 * for example: `interface MyNodeSharedState extends A2ASharedState { myProp: string; }`.
 *
 * @template S SharedState type, MUST extend `A2ASharedState`.
 * @template P Params type
 * @template PrepResult Type returned by prepare()
 * @template ExecResult Type returned by execute()
 * @template Action Type of action result (string or enum)
 */
export abstract class A2ABaseNode<
  S extends A2ASharedState = A2ASharedState, // <-- Constrain S to extend A2ASharedState
  P extends Params = Params,
  PrepResult = unknown,
  ExecResult = unknown,
  Action extends ActionResult = ActionResult,
> extends BaseNode<S, P, PrepResult, ExecResult, Action> {
  /**
   * Access the full incoming A2A Message from the client request.
   * This message object is expected to be populated by the A2A server handler
   * into the shared state under the key `__a2a_incoming_message`.
   *
   * @param shared The current shared state object.
   * @returns The incoming Message object, or `undefined` if not present in shared state (e.g., not in an A2A context or server handler didn't populate it).
   */
  protected getIncomingMessage(shared: S): Message | undefined {
    // We assume the A2A server handler places the incoming message here.
    return shared.__a2a_incoming_message; // Access directly after constraint change
  }

  /**
   * Access the parts array of the incoming A2A Message.
   * Convenience helper calling `getIncomingMessage(shared)?.parts`.
   *
   * @param shared The current shared state object.
   * @returns An array of Message Parts, or an empty array if no incoming message or the message has no parts.
   */
  protected getIncomingParts(shared: S): Part[] {
    const message = this.getIncomingMessage(shared);
    // Ensure parts is an array, even if null or undefined in message
    return Array.isArray(message?.parts) ? message!.parts : [];
  }

  /**
   * Find the first DataPart within the incoming A2A Message's parts.
   * Convenience helper using `getIncomingParts(shared).find(isDataPart)`.
   *
   * @param shared The current shared state object.
   * @returns The first DataPart found, or `undefined` if no DataPart exists in the incoming message or no incoming message is available.
   */
  protected getIncomingDataPart(shared: S): DataPart | undefined {
    return this.getIncomingParts(shared).find(isDataPart);
  }

  /**
   * Retrieve the data payload object from the first DataPart in the incoming A2A Message.
   * Convenience helper calling `getIncomingDataPart(shared)?.data`.
   *
   * @param shared The current shared state object.
   * @returns The data object, or `undefined` if no DataPart is found or if the data property is missing/not an object.
   */
  protected getIncomingData(shared: S): Record<string, unknown> | undefined {
    const dataPart = this.getIncomingDataPart(shared);
    // Ensure data exists and is an object before returning
    return dataPart &&
      typeof dataPart.data === "object" &&
      dataPart.data !== null
      ? (dataPart.data as Record<string, unknown>)
      : undefined;
  }

  /**
   * Set the array of Parts that should form the final A2A response message for a `tasks/send` request.
   * This array is stored in the shared state under the key `__a2a_final_response_parts`
   * and is intended to be picked up by the A2A server handler after the flow completes.
   * Calling this method will overwrite any previously set final response parts in shared state.
   *
   * @param shared The current shared state object.
   * @param parts The array of `Part` objects (TextPart, FilePart, DataPart, FilePart) to use for the final response message.
   */
  protected setFinalResponseParts(shared: S, parts: Part[]): void {
    // Ensure we store a valid array of parts
    shared.__a2a_final_response_parts = Array.isArray(parts) ? parts : [];
  }

  /**
   * Add a single `Part` to the array of parts destined for the final A2A response message (`tasks/send`).
   * If `__a2a_final_response_parts` doesn't exist or is not an array, it will be initialized as an empty array before adding the part.
   *
   * @param shared The current shared state object.
   * @param part The `Part` object to add (TextPart, FilePart, DataPart, FilePart).
   */
  protected addFinalResponsePart(shared: S, part: Part): void {
    // Ensure the target in shared state is an array
    if (
      !shared.__a2a_final_response_parts ||
      !Array.isArray(shared.__a2a_final_response_parts)
    ) {
      shared.__a2a_final_response_parts = [];
    }
    // Add the part to the array
    shared.__a2a_final_response_parts.push(part); // Access directly after constraint change
  }

  /**
   * Convenience method to set the final A2A response using a single DataPart.
   * Creates a `DataPart` from the provided data and optional metadata, then calls `setFinalResponseParts(shared, [dataPart])`.
   * Overwrites any previously set final response parts in shared state.
   *
   * @param shared The current shared state object.
   * @param data The data object (`Record<string, unknown>`) to be included in the DataPart.
   * @param metadata Optional metadata for the DataPart.
   */
  protected setFinalResponseData(
    shared: S,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown> | null,
  ): void {
    // Ensure data is a valid object before creating the part
    const dataToStore = typeof data === "object" && data !== null ? data : {};
    const dataPart: DataPart = { type: "data", data: dataToStore, metadata };
    this.setFinalResponseParts(shared, [dataPart]);
  }

  /**
   * Emit an artifact update event. This is primarily used for streaming flows (`tasks/sendSubscribe`)
   * where artifacts can be sent to the client in real-time as they are generated by the agent.
   * This method calls the `onArtifact` hook provided by the Flow.
   *
   * @param artifact The artifact object to emit. At a minimum, it should include `parts`.
   */
  protected emitArtifact(artifact: Partial<Artifact>): void {
    // Check if the flow hook is available before calling it
    if (this.flow?.onArtifact) {
      // We cast to `any` here because the `onArtifact` hook's exact signature
      // might be flexible, and nodes might provide partial Artifact structures.
      // The server handler is responsible for validating and formatting the
      // final TaskArtifactUpdateEvent payload.
      this.flow.onArtifact(artifact as any);
    }
  }

  /**
   * Helper method to create a TextPart object.
   *
   * @param text The text content of the part.
   * @param metadata Optional metadata for the part.
   * @returns A TextPart object.
   */
  protected createTextPart(
    text: string,
    metadata?: Record<string, unknown> | null,
  ): TextPart {
    return { type: "text", text, metadata };
  }

  /**
   * Helper method to create a DataPart object.
   *
   * @param data The data object for the part.
   * @param metadata Optional metadata for the part.
   * @returns A DataPart object.
   */
  protected createDataPart(
    data: Record<string, unknown>,
    metadata?: Record<string, unknown> | null,
  ): DataPart {
    // Ensure data is a valid object
    const dataToStore = typeof data === "object" && data !== null ? data : {};
    return { type: "data", data: dataToStore, metadata };
  }

  /**
   * Helper method to create a FilePart object.
   * The `fileContent` object must contain either `bytes` or `uri`,
   * and optionally `name` and `mimeType`.
   *
   * @param fileContent The FileContent object defining the file data (bytes or uri).
   * @param metadata Optional metadata for the FilePart.
   * @returns A FilePart object.
   * @throws Error if fileContent is missing both bytes and uri.
   */
  protected createFilePart(
    fileContent: FileContent,
    metadata?: Record<string, unknown> | null,
  ): FilePart {
    if (
      !fileContent ||
      (fileContent.bytes === undefined && fileContent.uri === undefined)
    ) {
      throw new Error(
        "FilePart requires fileContent with either 'bytes' or 'uri'.",
      );
    }
    // Basic validation for fileContent structure (optional, schema validation is better at edges)
    const validFileContent: FileContent = {
      name: fileContent.name,
      mimeType: fileContent.mimeType,
      bytes: fileContent.bytes,
      uri: fileContent.uri,
    };
    return { type: "file", file: validFileContent, metadata };
  }

  // Note: Helpers for status updates are best handled via `this.flow?.onStatusUpdate`
  // as they require context (like step index, total steps) that the Flow/Orchestrator
  // is better positioned to provide accurately during the execution lifecycle.
}
