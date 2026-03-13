import type { AgentConfig } from "@matrix/protocol";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  agents: AgentConfig[];
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.MATRIX_PORT || "8080", 10),
    host: process.env.MATRIX_HOST || "0.0.0.0",
    dbPath: process.env.MATRIX_DB_PATH || "./matrix.db",
    agents: [
      {
        id: "claude-code-acp",
        name: "Claude Code",
        command: process.env.CLAUDE_CODE_ACP_PATH || "claude-code-acp",
        args: [],
      },
    ],
  };
}
