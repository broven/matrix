import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import type { AgentTestStep, AgentTestResult } from "@matrix/protocol";
import { encodeJsonRpc, parseJsonRpcMessages, type JsonRpcMessage } from "../../acp-bridge/jsonrpc.js";

const SPAWN_TIMEOUT_MS = 3_000;
const STEP_TIMEOUT_MS = 20_000;

/**
 * Test an ACP agent by spawning it and running through protocol steps.
 * Lightweight — does NOT reuse AcpBridge.
 */
export async function testAcpAgent(config: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<AgentTestResult> {
  const steps: AgentTestStep[] = [];
  let proc: ChildProcess | null = null;
  let buffer = "";
  let nextId = 1;

  function addStep(name: AgentTestStep["name"], status: AgentTestStep["status"], durationMs: number, error?: string): void {
    steps.push({ name, status, durationMs, ...(error ? { error } : {}) });
  }

  function skipRemaining(from: number): void {
    const allSteps: AgentTestStep["name"][] = ["spawn", "initialize", "session/new", "prompt"];
    for (let i = from; i < allSteps.length; i++) {
      addStep(allSteps[i], "skipped", 0);
    }
  }

  function sendRequest(method: string, params: unknown): number {
    const id = nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    proc!.stdin!.write(encodeJsonRpc(message));
    return id;
  }

  function waitForResponse(requestId: number, timeoutMs: number, opts?: { acceptNotifications?: boolean }): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      function onData(data: Buffer) {
        buffer += data.toString();
        const { messages, remainder } = parseJsonRpcMessages(buffer);
        buffer = remainder;
        for (const msg of messages) {
          if (msg.id === requestId && (msg.result !== undefined || msg.error !== undefined)) {
            clearTimeout(timer);
            proc!.stdout!.off("data", onData);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg);
            }
            return;
          }
          // Accept notifications as evidence the agent is alive (e.g. session/update during prompt)
          if (opts?.acceptNotifications && msg.id === undefined && msg.method !== undefined) {
            clearTimeout(timer);
            proc!.stdout!.off("data", onData);
            resolve(msg);
            return;
          }
        }
      }

      proc!.stdout!.on("data", onData);
    });
  }

  function cleanup(): void {
    if (proc && !proc.killed) {
      proc.kill();
    }
  }

  try {
    // Step 1: spawn
    const spawnStart = Date.now();
    try {
      proc = await new Promise<ChildProcess>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out after ${SPAWN_TIMEOUT_MS}ms`)), SPAWN_TIMEOUT_MS);
        const child = spawn(config.command, config.args, {
          env: { ...process.env, ...config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        // Consider spawn successful once the process has a pid
        // Use a short delay to catch immediate failures (e.g. ENOENT)
        setTimeout(() => {
          clearTimeout(timer);
          if (child.killed || child.exitCode !== null) {
            reject(new Error("Process exited immediately"));
          } else {
            resolve(child);
          }
        }, 200);
      });
      addStep("spawn", "pass", Date.now() - spawnStart);
    } catch (err: any) {
      addStep("spawn", "fail", Date.now() - spawnStart, err.message);
      skipRemaining(1);
      return { steps };
    }

    // Step 2: initialize
    const initStart = Date.now();
    try {
      const id = sendRequest("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "matrix-test", version: "1.0.0" },
      });
      await waitForResponse(id, STEP_TIMEOUT_MS);
      addStep("initialize", "pass", Date.now() - initStart);
    } catch (err: any) {
      addStep("initialize", "fail", Date.now() - initStart, err.message);
      skipRemaining(2);
      return { steps };
    }

    // Step 3: session/new
    const sessionStart = Date.now();
    let agentSessionId: string | undefined;
    try {
      const id = sendRequest("session/new", { cwd: os.tmpdir(), mcpServers: [] });
      const response = await waitForResponse(id, STEP_TIMEOUT_MS);
      agentSessionId = (response.result as any)?.sessionId;
      if (typeof agentSessionId !== "string" || !agentSessionId) {
        throw new Error("session/new response missing sessionId");
      }
      addStep("session/new", "pass", Date.now() - sessionStart);
    } catch (err: any) {
      addStep("session/new", "fail", Date.now() - sessionStart, err.message);
      skipRemaining(3);
      return { steps };
    }

    // Step 4: prompt
    const promptStart = Date.now();
    try {
      const id = sendRequest("session/prompt", {
        sessionId: agentSessionId,
        prompt: [{ type: "text", text: "hello" }],
      });
      // Wait for result or any notification (e.g. session/update) as evidence agent is responding
      await waitForResponse(id, STEP_TIMEOUT_MS, { acceptNotifications: true });
      addStep("prompt", "pass", Date.now() - promptStart);
    } catch (err: any) {
      addStep("prompt", "fail", Date.now() - promptStart, err.message);
    }

    return { steps };
  } finally {
    cleanup();
  }
}
