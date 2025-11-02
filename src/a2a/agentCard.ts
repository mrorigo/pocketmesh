import {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  AgentProvider,
  AgentInterface,
  AgentCardSignature,
  SecurityScheme,
} from "./types";

/**
 * Generate an AgentCard for this PocketMesh agent.
 * @param opts - Agent metadata and skills.
 */
export function generateAgentCard(opts: {
  name: string;
  url: string;
  version: string;
  protocolVersion?: string;
  description?: string;
  documentationUrl?: string;
  iconUrl?: string;
  provider?: AgentProvider;
  capabilities?: AgentCapabilities;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  preferredTransport?: string;
  additionalInterfaces?: AgentInterface[];
  security?: Array<Record<string, string[]>>;
  securitySchemes?: Record<string, SecurityScheme>;
  signatures?: AgentCardSignature[];
  supportsAuthenticatedExtendedCard?: boolean;
  skills: AgentSkill[];
}): AgentCard {
  const card: AgentCard = {
    name: opts.name,
    url: opts.url,
    version: opts.version,
    protocolVersion: opts.protocolVersion ?? "0.3.0",
    preferredTransport: opts.preferredTransport ?? "JSONRPC",
    description: opts.description ?? "",
    capabilities: opts.capabilities ?? {},
    defaultInputModes: opts.defaultInputModes ?? ["text"],
    defaultOutputModes: opts.defaultOutputModes ?? ["text"],
    skills: opts.skills,
  };

  if (opts.documentationUrl) {
    card.documentationUrl = opts.documentationUrl;
  }
  if (opts.iconUrl) {
    card.iconUrl = opts.iconUrl;
  }
  if (opts.provider) {
    card.provider = opts.provider;
  }
  if (opts.additionalInterfaces) {
    card.additionalInterfaces = opts.additionalInterfaces;
  }
  if (opts.security) {
    card.security = opts.security;
  }
  if (opts.securitySchemes) {
    card.securitySchemes = opts.securitySchemes;
  }
  if (opts.signatures) {
    card.signatures = opts.signatures;
  }
  if (typeof opts.supportsAuthenticatedExtendedCard === "boolean") {
    card.supportsAuthenticatedExtendedCard =
      opts.supportsAuthenticatedExtendedCard;
  };

  return card;
}
