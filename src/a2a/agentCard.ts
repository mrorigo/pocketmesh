import {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  AgentProvider,
  AgentAuthentication,
} from "./types";

/**
 * Generate an AgentCard for this PocketMesh agent.
 * @param opts - Agent metadata and skills.
 */
export function generateAgentCard(opts: {
  name: string;
  url: string;
  version: string;
  description?: string;
  documentationUrl?: string;
  provider?: AgentProvider;
  capabilities?: AgentCapabilities;
  authentication?: AgentAuthentication;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: AgentSkill[];
}): AgentCard {
  return {
    name: opts.name,
    url: opts.url,
    version: opts.version,
    description: opts.description ?? null,
    documentationUrl: opts.documentationUrl ?? null,
    provider: opts.provider ?? null,
    capabilities: opts.capabilities ?? {},
    authentication: opts.authentication ?? null,
    defaultInputModes: opts.defaultInputModes ?? ["text"],
    defaultOutputModes: opts.defaultOutputModes ?? ["text"],
    skills: opts.skills,
  };
}
