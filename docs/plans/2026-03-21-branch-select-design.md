# Branch Select Component Design

## Goal

Replace all plain-text branch input fields with a searchable select (combobox) component that lists local and remote branches.

## Affected Locations

| Dialog | Field | File | Current |
|--------|-------|------|---------|
| Create Session | Base branch | `NewWorktreeDialog.tsx` | `<Input>` |
| Clone from URL | Branch (optional) | `CloneFromUrlDialog.tsx` | `<Input>` |

> "Branch name" in Create Session stays as `<Input>` — it's for creating a new branch name, not selecting an existing one.

## Stack Changes

### 1. Protocol (`@matrix/protocol`)

```typescript
// repository.ts
export interface BranchInfo {
  name: string;        // e.g. "main", "feat/login", "origin/feat/login"
  isRemote: boolean;   // true for remote-tracking branches
  isDefault: boolean;  // true for repo's default branch
}
```

### 2. Server (`@matrix/server`)

**WorktreeManager** — new method:

```typescript
async listBranches(repoPath: string): Promise<BranchInfo[]>
```

- Runs `git branch -a --format='%(refname:short)'`
- Parses output into `BranchInfo[]`
- Marks remote branches (`remotes/origin/...`) with `isRemote: true`
- Marks default branch with `isDefault: true`
- Strips `origin/` prefix from remote names for display, but keeps full ref for value

**REST endpoint:**

```
GET /repositories/:repoId/branches → BranchInfo[]
```

### 3. SDK (`@matrix/sdk`)

```typescript
async getBranches(repositoryId: string): Promise<BranchInfo[]>
```

### 4. Client UI (`@matrix/client`)

**Dependencies:** Add `cmdk` package (shadcn combobox pattern).

**New component:** `packages/client/src/components/ui/branch-select.tsx`

```typescript
interface BranchSelectProps {
  repositoryId: string;
  value: string;
  onChange: (branch: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}
```

**Behavior:**
- Popover trigger shows selected branch or placeholder
- Opens a Command (cmdk) popover with search input
- Branches grouped: **Local** then **Remote**
- Default branch pinned to top of Local group
- Search filters both groups
- Selecting a remote branch uses the short name (without `origin/`)
- Fetches branches via SDK when popover opens (with caching)

### 5. Integration

**NewWorktreeDialog.tsx** — Replace Base branch `<Input>` with `<BranchSelect>`:
- `repositoryId={repository.id}`
- `value={baseBranch}`
- `onChange={setBaseBranch}`
- Add `data-testid="worktree-base-branch-select"`

**CloneFromUrlDialog.tsx** — Replace Branch `<Input>` with `<BranchSelect>`:
- Only enabled after URL is validated (repo must be accessible)
- `repositoryId` not available (repo not cloned yet) — needs special handling
- Option A: fetch branches from remote URL via `git ls-remote --heads <url>`
- Option B: keep as text input for clone dialog (no local repo to query)
- **Decision: Use `git ls-remote` for clone dialog** — server needs a separate endpoint

**Additional endpoint for clone:**
```
POST /branches/remote → BranchInfo[]
Body: { url: string }
```
Runs `git ls-remote --heads <url>` to list branches from a remote URL before cloning.

## File Checklist

- [ ] `packages/protocol/src/repository.ts` — Add `BranchInfo` type
- [ ] `packages/server/src/worktree-manager/index.ts` — Add `listBranches()`, `listRemoteBranches(url)`
- [ ] `packages/server/src/api/rest/repositories.ts` — Add `GET /:repoId/branches`, `POST /branches/remote`
- [ ] `packages/sdk/src/client.ts` — Add `getBranches()`, `getRemoteBranches(url)`
- [ ] `packages/client/package.json` — Add `cmdk` dependency
- [ ] `packages/client/src/components/ui/branch-select.tsx` — New component
- [ ] `packages/client/src/components/worktree/NewWorktreeDialog.tsx` — Use `<BranchSelect>`
- [ ] `packages/client/src/components/repository/CloneFromUrlDialog.tsx` — Use `<BranchSelect>` with remote URL mode
