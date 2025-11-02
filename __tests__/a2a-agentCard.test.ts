import { generateAgentCard } from "../src/a2a/agentCard";
import type { AgentCapabilities, AgentProvider } from "../src/a2a/types";

describe("generateAgentCard", () => {
  it("populates defaults for minimal input", () => {
    const card = generateAgentCard({
      name: "Demo Agent",
      url: "http://localhost:4000",
      version: "0.1.0",
      skills: [
        {
          id: "echo",
          name: "Echo",
          description: "",
          tags: [],
          inputModes: ["text"],
          outputModes: ["text"],
          examples: [],
        },
      ],
    });

    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.defaultInputModes).toEqual(["text"]);
    expect(card.defaultOutputModes).toEqual(["text"]);
    expect(card.description).toBe("");
  });

  it("applies optional fields when provided", () => {
    const capabilities: AgentCapabilities = {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    };
    const provider: AgentProvider = {
      organization: "PocketMesh Inc.",
      url: "https://pocketmesh.dev",
    };

    const card = generateAgentCard({
      name: "Advanced Agent",
      url: "https://agent.example.com",
      version: "1.2.3",
      protocolVersion: "0.3.4",
      description: "Does advanced things",
      documentationUrl: "https://docs.example.com",
      iconUrl: "https://cdn.example.com/icon.png",
      provider,
      capabilities,
      defaultInputModes: ["text", "image"],
      defaultOutputModes: ["text", "file"],
      preferredTransport: "JSONRPC",
      additionalInterfaces: [
        { transport: "JSONRPC", url: "https://agent.example.com/a2a" },
      ],
      security: [{ bearerAuth: [] }],
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      signatures: [
        {
          protected: "header",
          signature: "sig",
        },
      ],
      supportsAuthenticatedExtendedCard: true,
      skills: [
        {
          id: "plan",
          name: "Plan",
          description: "Creates plans",
          tags: ["planning"],
          inputModes: ["text"],
          outputModes: ["text"],
          examples: ["Plan a trip"],
        },
      ],
    });

    expect(card.documentationUrl).toBe("https://docs.example.com");
    expect(card.iconUrl).toBe("https://cdn.example.com/icon.png");
    expect(card.provider).toEqual(provider);
    expect(card.capabilities).toEqual(capabilities);
    expect(card.additionalInterfaces?.length).toBe(1);
    expect(card.securitySchemes?.bearerAuth.type).toBe("http");
    expect(card.signatures?.[0].signature).toBe("sig");
    expect(card.supportsAuthenticatedExtendedCard).toBe(true);
  });
});
