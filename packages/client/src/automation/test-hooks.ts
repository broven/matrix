const TEST_STATE_KEY = "__MATRIX_AUTOMATION_TEST_STATE__";

export function seedAutomationTestState(value: unknown): void {
  (window as any)[TEST_STATE_KEY] = value;
}

export function readAutomationTestState(): unknown {
  const value = (window as any)[TEST_STATE_KEY];
  return value === undefined ? null : value;
}

export function resetAutomationTestState(): void {
  delete (window as any)[TEST_STATE_KEY];
}

export function dispatchAutomationEvent(name: string, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}
