export interface KnownAgent {
  /** Agent ID in the ACP Registry */
  registryId: string;
  /** Command to detect on the local system */
  detectCommand: string;
  /** Trusted npx package name (used instead of registry data) */
  npxPackage: string;
  /** Trusted npx args (used instead of registry data) */
  npxArgs?: string[];
  /** Trusted env vars to set when spawning */
  env?: Record<string, string>;
}

export const KNOWN_AGENTS: KnownAgent[] = [
  { registryId: "claude-acp", detectCommand: "claude", npxPackage: "claude-code-acp" },
  { registryId: "codex-acp", detectCommand: "codex", npxPackage: "codex-acp" },
  { registryId: "gemini", detectCommand: "gemini", npxPackage: "gemini-acp" },
  { registryId: "cline", detectCommand: "cline", npxPackage: "cline-acp" },
  { registryId: "auggie", detectCommand: "auggie", npxPackage: "auggie-acp" },
  { registryId: "amp-acp", detectCommand: "amp", npxPackage: "amp-acp" },
  { registryId: "codebuddy-code", detectCommand: "codebuddy", npxPackage: "codebuddy-code-acp" },
  { registryId: "aider", detectCommand: "aider", npxPackage: "aider-acp" },
];
