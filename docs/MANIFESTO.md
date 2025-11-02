# Manifesto for Building Agent-to-Agent (A2A) Systems

## Vision  
We believe that autonomous agents—specialized, independent, purposeful entities—are no longer isolated tools but collaborating peers.  
We imagine an ecosystem where one agent can call on another, and together they build something greater than either could alone.  
We ask: Why should every integration be bespoke and brittle?  
We instead commit to **interoperability, modularity, and federation**.  
We seek to build systems of agents that:  
- Discover each other’s capabilities.  
- Share tasks, messages, artifacts.  
- Orchestrate workflows across domains.  
- Respect each agent’s autonomy and provenance.

## Principles  

### 1. Peer-first collaboration  
Agents are not merely tools called by humans. They are **peers** interacting under a standard protocol.  
Thus:  
- Each agent exposes a clear “agent card” describing its identity, endpoint, capabilities.  
- Agents send tasks and messages, exchange artifacts, update states (submitted → working → completed) through standardized lifecycles.  
- Agents don’t assume monolithic control—they coordinate.

### 2. Standardisation & openness  
Interoperability hinges on a shared protocol.  
We commit to building on **open standards**, avoiding lock-in, and encouraging ecosystem growth.  
Therefore:  
- Use open-source SDKs, conforming to the protocol.  
- Publish Agent Cards so other agents can discover you.  
- Avoid ad-hoc, proprietary “glue code” for every integration.

### 3. Modularity, specialization, composition  
Each agent should **own** one or more specific skills/capabilities. Rather than build one monolithic super-agent, build many focused agents and compose them.  
Thus:  
- Define clear capability boundaries.  
- Agents advertise their capabilities.  
- Agents coordinate rather than duplicate.

### 4. Secure, opaque collaboration  
While agents collaborate, each should maintain autonomy over its internal workings: tools, memory, proprietary logic.  
Security, authentication, authorization must be built in.  
We commit to:  
- Minimal exposure of internal state beyond what’s necessary.  
- Secure transports, identity validation, capability scopes.  
- Auditable, accountable interactions.

### 5. Dynamic discovery and adaptability  
Agents should not be statically wired. Instead, they should **discover** other agents at runtime via their cards and capabilities. They should adapt to workflow changes and evolving capabilities.  
Thus:  
- Agents list their endpoint, supported modalities, data types.  
- Agents can switch roles depending on context.  
- The system supports long-running tasks, streaming results, partial updates.

### 6. Workflow transparency & traceability  
In complex multi-agent workflows, it must be possible to trace which agent did what and how results were composed.  
We commit to logging, artifact provenance, versioning.  
Thus:  
- Each task has lifecycle states and artifact outputs.  
- Agents publish identity, version, capability history.  
- Collaboration graphs should be auditable.

### 7. Human-in-the-loop & value alignment  
Even as agents coordinate amongst themselves, humans remain the ultimate stakeholders.  
Agents must align with human values, comply with regulations, and include mechanisms for oversight, overrides, and feedback loops.  
We commit to:  
- Clear responsibility assignment (which agent handled which part).  
- Transparency for users and operators: what’s happening, what’s being computed.  
- Safeguards against undesirable behaviors, runaway workflows, non-transparent decision-making.

### 8. Scalability & evolution  
The architecture must scale: adding new agents, domains, workflows should not require rewriting integrations.  
We commit to:  
- Designing for change: new agents can join/fail gracefully.  
- Versioning of agent cards and capabilities.  
- Backward compatibility and graceful deprecation.

## Call to Action  
If you are building, designing or deploying autonomous agents—adopt this manifesto:  
- Publish your agent’s card: who you are, what you can do, how to talk to you.  
- Build for peer-to-peer agent interaction, not just user-to-agent.  
- Avoid siloed, one-off integrations. Embrace composition.  
- Make security, discoverability and transparency foundational.  
- Involve humans in designing oversight, traceability, and alignment.  
- Think ecosystem, not just isolated agent solutions.

## Why Now  
The era of isolated AI agents is giving way to ecosystems of collaborating agents. As agents become more capable, solving complex tasks will require not one agent, but many working together. Interoperability becomes a strategic advantage.

## Final Word  
We build agent-to-agent systems not because we want many agents, but because **the whole becomes greater than the sum of the parts**.  
We envision an ecosystem of intelligent agents, modular by nature, interoperable by design, aligned with human value, and governed by transparent workflows.  
This is our manifesto for building it.
