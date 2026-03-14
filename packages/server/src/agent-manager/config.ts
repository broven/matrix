import type { AgentConfig } from "@matrix/protocol";
import { existsSync } from "node:fs";

export function isAgentAvailable(config: AgentConfig): boolean {
  if (config.command.startsWith("/")) {
    return existsSync(config.command);
  }
  return true;
}
