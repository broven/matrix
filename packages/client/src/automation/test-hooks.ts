const TEST_STATE_KEY = "__MATRIX_AUTOMATION_TEST_STATE__";
const TEST_STATE_SCOPE_PREFIX = "__MATRIX_AUTOMATION_TEST_SCOPE__:";

export function seedAutomationTestState(value: unknown): void {
  (window as any)[TEST_STATE_KEY] = value;
}

export function readAutomationTestState(): unknown {
  const value = (window as any)[TEST_STATE_KEY];
  return value === undefined ? null : value;
}

export function seedAutomationTestStateScope(scope: string, value: unknown): void {
  (window as any)[`${TEST_STATE_SCOPE_PREFIX}${scope}`] = value;
}

export function readAutomationTestStateScope(scope: string): unknown {
  const value = (window as any)[`${TEST_STATE_SCOPE_PREFIX}${scope}`];
  return value === undefined ? null : value;
}

function clearAutomationTestStateScope(scope: string): void {
  delete (window as any)[`${TEST_STATE_SCOPE_PREFIX}${scope}`];
}

export function resetAutomationTestState(scopes?: string[]): void {
  if (scopes) {
    if (scopes.length === 0) {
      return;
    }
    for (const scope of scopes) {
      clearAutomationTestStateScope(scope);
    }
    return;
  }

  delete (window as any)[TEST_STATE_KEY];
  Object.keys(window as any)
    .filter((key) => key.startsWith(TEST_STATE_SCOPE_PREFIX))
    .forEach((key) => {
      delete (window as any)[key];
    });
}

export function dispatchAutomationEvent(name: string, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}
