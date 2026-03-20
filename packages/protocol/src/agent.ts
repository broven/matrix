/** Agent configuration — how to start an ACP agent */
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  icon?: string;
  description?: string;
}

/** User-defined custom agent */
export interface CustomAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  icon?: string;
  description?: string;
}

/** Environment profile for an agent (built-in or custom) */
export interface AgentEnvProfile {
  id: string;
  parentAgentId: string;
  name: string;
  env: Record<string, string>;
}

/** Agent info returned after ACP initialize */
export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
}

/** Result of testing an ACP agent's protocol compliance */
export interface AgentTestResult {
  steps: AgentTestStep[];
}

export interface AgentTestStep {
  name: "spawn" | "initialize" | "session/new" | "prompt";
  status: "pass" | "fail" | "skipped";
  error?: string;
  durationMs: number;
}

/** Agent capabilities returned after ACP initialize */
export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
}
