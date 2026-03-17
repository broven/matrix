import { beforeEach, describe, expect, it } from "vitest";
import { installAutomationBridge } from "@/automation/bridge";
import { readAutomationTestState, seedAutomationTestState } from "@/automation/test-hooks";

describe("automation bridge", () => {
  beforeEach(() => {
    delete (window as any).__MATRIX_AUTOMATION__;
  });

  it("installs bridge and exposes expected methods", () => {
    const bridge = installAutomationBridge({ mode: "test", dev: false });
    expect((window as any).__MATRIX_AUTOMATION__).toBeDefined();
    expect(bridge).toBeDefined();
    expect(typeof bridge?.getSnapshot).toBe("function");
    expect(typeof bridge?.resetTestState).toBe("function");
    expect(typeof bridge?.dispatchEvent).toBe("function");
  });

  it("installs bridge in development mode", () => {
    const bridge = installAutomationBridge({ mode: "development", dev: true });
    expect((window as any).__MATRIX_AUTOMATION__).toBeDefined();
    expect(bridge).toBeDefined();
  });

  it("returns a JSON-safe snapshot", () => {
    const bridge = installAutomationBridge({ mode: "test", dev: false });
    const cyclic: Record<string, unknown> = { foo: "bar", bad: undefined };
    cyclic.self = cyclic;
    seedAutomationTestState({
      cyclic,
      fn: () => "x",
      nested: { value: 123, symbol: Symbol("s") },
      big: BigInt(42),
    });
    const snapshot = bridge?.getSnapshot();
    const encoded = JSON.stringify(snapshot);
    expect(encoded).toBeTruthy();
    expect(JSON.parse(encoded ?? "{}")).toEqual(snapshot);
  });

  it("clears seeded state on reset", () => {
    const bridge = installAutomationBridge({ mode: "test", dev: false });
    seedAutomationTestState({ foo: "bar" });
    expect(readAutomationTestState()).toEqual({ foo: "bar" });
    bridge?.resetTestState();
    expect(readAutomationTestState()).toBeNull();
  });

  it("dispatches a custom event", () => {
    const bridge = installAutomationBridge({ mode: "test", dev: false });
    let payload: unknown = null;
    window.addEventListener("automation:test", (event) => {
      payload = (event as CustomEvent).detail;
    });

    bridge?.dispatchEvent("automation:test", { step: "ok" });
    expect(payload).toEqual({ step: "ok" });
  });
});
