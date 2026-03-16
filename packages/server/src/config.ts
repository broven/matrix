import type { AgentConfig } from "@matrix/protocol";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string | null;
  localMode: boolean;
  agents: AgentConfig[];
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

export function loadConfig(): ServerConfig {
  const args = parseArgs();
  const localMode = args.local === "true" || process.env.MATRIX_LOCAL === "true" || false;
  return {
    port: parseInt(args.port || process.env.MATRIX_PORT || "8080", 10),
    host: localMode ? "127.0.0.1" : (args.host || process.env.MATRIX_HOST || "0.0.0.0"),
    dbPath: args.db || process.env.MATRIX_DB_PATH || "./matrix.db",
    webDir: args.web || process.env.MATRIX_WEB_DIR || null,
    localMode,
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
