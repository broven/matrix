import { describe, it, expect, beforeEach } from "vitest";
import { AgentManager } from "../agent-manager/index.js";
import type { AgentConfig } from "@matrix/protocol";

const testConfig: AgentConfig = {
  id: "echo-agent",
  name: "Echo Agent",
  command: "cat",
  args: [],
};

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    manager = new AgentManager();
  });

  it("registers an agent config", () => {
    manager.register(testConfig);
    const agents = manager.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("echo-agent");
  });

  it("checks agent availability", () => {
    manager.register(testConfig);
    const agents = manager.listAgents();
    expect(agents[0].available).toBe(true);
  });

  it("spawns a process and returns a handle", () => {
    manager.register(testConfig);
    const handle = manager.spawn("echo-agent", "/tmp");
    expect(handle).toBeDefined();
    expect(handle.process.pid).toBeDefined();
    handle.process.kill();
  });

  it("throws on unknown agent id", () => {
    expect(() => manager.spawn("nonexistent", "/tmp")).toThrow("Unknown agent");
  });
});
