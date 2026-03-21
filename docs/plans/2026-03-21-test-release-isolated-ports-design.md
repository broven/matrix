# test:e2e:mac Isolated Ports

## Problem

`pnpm test:e2e:mac` depends on `dev:mac` via wireit. Both use the same ports from `.env.local`, so running `dev:mac` manually and `test:e2e:mac` simultaneously causes port conflicts.

## Solution

Give test:e2e:mac its own port set so it can coexist with dev:mac.

## Port Allocation

```
BASE_PORT + 0  CLIENT_PORT       (dev)
BASE_PORT + 1  HMR_PORT          (dev)
BASE_PORT + 2  MATRIX_PORT       (dev)
BASE_PORT + 3  SIDECAR_PORT      (dev)
BASE_PORT + 4  TEST_CLIENT_PORT  (test)
BASE_PORT + 5  TEST_HMR_PORT     (test)
BASE_PORT + 6  TEST_MATRIX_PORT  (test)
BASE_PORT + 7  TEST_SIDECAR_PORT (test)
```

TOKEN shared: test reuses `MATRIX_TOKEN` from dev.

## File Changes

### 1. `.config/wt.toml` — env-local hook

Add TEST_ port derivation (+4 to +7), write `.env.test.local` with standard variable names mapped to TEST_ ports. Update pre-remove kill range from +0~+3 to +0~+7.

### 2. `packages/server/package.json` — ENV_FILE support

Change `--env-file=../../.env.local` to `--env-file=../../${ENV_FILE:-.env.local}` in all commands that reference it. Default behavior unchanged.

### 3. `packages/client/package.json` — ENV_FILE support

Change `. ../../.env.local` to `. ../../${ENV_FILE:-.env.local}` in all wireit commands. Default behavior unchanged.

### 4. `package.json` — dev:mac:test + test:e2e:mac rewire

Add `dev:mac:test` script: `ENV_FILE=.env.test.local pnpm dev:mac`. Change `test:e2e:mac` wireit dependency from `dev:mac` to `dev:mac:test`.

### 5. `tests/e2e/mac/vitest.config.ts` — load test env

Change dotenv to load `.env.test.local` instead of `.env.local`.

## What Doesn't Change

- Server/client: no new targets, just ENV_FILE parameterization
- Test code: reads `MATRIX_PORT` / `MATRIX_TOKEN` as before, values come from `.env.test.local`
- `dev:mac` default behavior: unchanged (ENV_FILE defaults to `.env.local`)
- `.gitignore`: `.env.*` already covers `.env.test.local`

## Implementation Order

1. wt.toml (port generation + .env.test.local + pre-remove)
2. server package.json (ENV_FILE)
3. client package.json (ENV_FILE)
4. root package.json (dev:mac:test + test:e2e:mac)
5. vitest.config.ts (dotenv path)
6. Regenerate current .env.local + .env.test.local for this worktree
