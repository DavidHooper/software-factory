/**
 * The `AGENT_*` variables a cloud environment sets for every agent run (see
 * docs/agents/runners.md). A session without `AGENT_RUN=1` is a human's own
 * session, and the agent-only hooks stay out of its way.
 */
export interface AgentEnv {
  agentRun: boolean;
  /** The run may change harness files (`AGENT_HARNESS=1`, set in every cloud environment). */
  harness: boolean;
  skill: string | undefined;
  runner: string | undefined;
}

export function readAgentEnv(env: NodeJS.ProcessEnv): AgentEnv {
  return {
    agentRun: env.AGENT_RUN === '1',
    harness: env.AGENT_HARNESS === '1',
    skill: env.AGENT_SKILL || undefined,
    runner: env.AGENT_RUNNER || undefined,
  };
}
