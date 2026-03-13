/** Agent configuration — how to start an ACP agent */
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Agent info returned after ACP initialize */
export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
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
