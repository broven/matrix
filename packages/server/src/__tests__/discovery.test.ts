import { describe, it, expect } from "vitest";
import {
  discoverAgentsWithDeps,
  FALLBACK_AGENTS,
  type RegistryResponse,
  type DiscoveryDeps,
} from "../agent-manager/discovery.js";
import type { KnownAgent } from "../agent-manager/known-agents.js";

const TEST_KNOWN_AGENTS: KnownAgent[] = [
  { registryId: "claude-acp", detectCommand: "claude", npxPackage: "claude-code-acp" },
  { registryId: "codex-acp", detectCommand: "codex", npxPackage: "codex-acp" },
  { registryId: "gemini", detectCommand: "gemini", npxPackage: "gemini-acp", npxArgs: ["--acp"] },
];

const MOCK_REGISTRY: RegistryResponse = {
  agents: [
    {
      id: "claude-acp",
      name: "Claude Agent",
      description: "ACP wrapper for Claude",
      icon: "https://cdn.example.com/claude.svg",
    },
    {
      id: "codex-acp",
      name: "Codex CLI",
      description: "ACP adapter for Codex",
      icon: "https://cdn.example.com/codex.svg",
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      description: "Google's Gemini CLI",
      icon: "https://cdn.example.com/gemini.svg",
    },
  ],
};

function makeDeps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    checkCommand: () => true,
    fetchRegistryData: async () => MOCK_REGISTRY,
    knownAgents: TEST_KNOWN_AGENTS,
    ...overrides,
  };
}

describe("discoverAgentsWithDeps", () => {
  it("returns fallback when npx is not installed", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => cmd !== "npx",
    });
    const agents = await discoverAgentsWithDeps(deps);

    expect(agents).toEqual(FALLBACK_AGENTS);
    expect(agents[0].id).toBe("claude-acp");
    expect(agents[0].command).not.toBe("npx");
  });

  it("discovers installed agents with registry metadata", async () => {
    const installed = new Set(["npx", "claude", "codex"]);
    const deps = makeDeps({
      checkCommand: (cmd) => installed.has(cmd),
    });
    const agents = await discoverAgentsWithDeps(deps);

    expect(agents).toHaveLength(2);

    const claude = agents.find((a) => a.id === "claude-acp")!;
    expect(claude.command).toBe("npx");
    expect(claude.name).toBe("Claude Agent");
    expect(claude.icon).toBe("https://cdn.example.com/claude.svg");
    expect(claude.description).toBe("ACP wrapper for Claude");

    const codex = agents.find((a) => a.id === "codex-acp")!;
    expect(codex.command).toBe("npx");
    expect(codex.name).toBe("Codex CLI");
  });

  it("uses local allowlist for npx package, not registry data", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => ["npx", "claude"].includes(cmd),
    });
    const agents = await discoverAgentsWithDeps(deps);

    const claude = agents.find((a) => a.id === "claude-acp")!;
    // Package must come from known-agents allowlist
    expect(claude.args).toContain("claude-code-acp");
    expect(claude.args).toContain("-y");
  });

  it("includes npxArgs from known-agents", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => ["npx", "gemini"].includes(cmd),
    });
    const agents = await discoverAgentsWithDeps(deps);

    const gemini = agents.find((a) => a.id === "gemini")!;
    expect(gemini.args).toEqual(["-y", "gemini-acp", "--acp"]);
  });

  it("works without registry (offline mode)", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => ["npx", "claude"].includes(cmd),
      fetchRegistryData: async () => null,
    });
    const agents = await discoverAgentsWithDeps(deps);

    const claude = agents.find((a) => a.id === "claude-acp")!;
    expect(claude.command).toBe("npx");
    expect(claude.name).toBe("claude"); // falls back to detectCommand
    expect(claude.icon).toBeUndefined();
  });

  it("handles registry fetch error gracefully", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => ["npx", "claude"].includes(cmd),
      fetchRegistryData: async () => {
        throw new Error("network error");
      },
    });
    const agents = await discoverAgentsWithDeps(deps);

    // Should still discover based on local detection
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("claude-acp");
    expect(agents[0].command).toBe("npx");
  });

  it("returns fallback when no known agents are installed", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => cmd === "npx", // only npx, no agents
    });
    const agents = await discoverAgentsWithDeps(deps);

    expect(agents).toEqual(FALLBACK_AGENTS);
  });

  it("skips agents not installed locally", async () => {
    const deps = makeDeps({
      checkCommand: (cmd) => ["npx", "claude"].includes(cmd),
    });
    const agents = await discoverAgentsWithDeps(deps);

    expect(agents.find((a) => a.id === "codex-acp")).toBeUndefined();
    expect(agents.find((a) => a.id === "gemini")).toBeUndefined();
  });

  it("discovers all agents when all are installed", async () => {
    const deps = makeDeps(); // all return true
    const agents = await discoverAgentsWithDeps(deps);

    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.id).sort()).toEqual(["claude-acp", "codex-acp", "gemini"]);
  });
});
