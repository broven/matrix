# Branch Select Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plain-text branch inputs with a searchable select (combobox) component that lists local and remote branches.

**Architecture:** Full-stack addition: Protocol type → Server git command → REST endpoint → SDK method → React combobox component → Integration into 2 dialogs. For the Clone dialog, a separate `git ls-remote` endpoint fetches branches from a remote URL before cloning.

**Tech Stack:** TypeScript, Bun shell (`$`), Hono REST, React 19, Radix UI (Popover), cmdk, Tailwind CSS

---

### Task 1: Add `BranchInfo` type to Protocol

**Files:**
- Modify: `packages/protocol/src/repository.ts:166` (append after `ServerConfig`)

**Step 1: Add the type**

Add at the end of `packages/protocol/src/repository.ts`:

```typescript
// ── Branch Listing ────────────────────────────────────────────────

/** Branch info returned by the branches API */
export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isDefault: boolean;
}
```

**Step 2: Verify build**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/protocol/src/repository.ts
git commit -m "feat: add BranchInfo type to protocol"
```

---

### Task 2: Add `listBranches` and `listRemoteBranches` to WorktreeManager

**Files:**
- Modify: `packages/server/src/worktree-manager/index.ts`

**Step 1: Add import and methods**

Add import at top of file (line 2):

```typescript
import type { BranchInfo } from "@matrix/protocol";
```

Add these methods to the `WorktreeManager` class, after the `validateGitRepo` method (after line 146):

```typescript
  /**
   * List all local and remote branches for a repository.
   */
  async listBranches(repoPath: string): Promise<BranchInfo[]> {
    const defaultBranch = await this.detectDefaultBranch(repoPath);

    const result = await $`git -C ${repoPath} branch -a --format=${"%(refname:short)"}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list branches: ${result.stderr.toString()}`);
    }

    const output = result.stdout.toString().trim();
    if (!output) return [];

    const branches: BranchInfo[] = [];
    const seen = new Set<string>();

    for (const line of output.split("\n")) {
      const name = line.trim();
      if (!name || name.includes("->")) continue; // skip HEAD pointers like origin/HEAD -> origin/main

      const isRemote = name.startsWith("origin/");
      const displayName = isRemote ? name.slice("origin/".length) : name;

      // Skip remote branches that have a local counterpart
      if (isRemote && seen.has(displayName)) continue;

      // If local branch, mark remote duplicate to skip
      if (!isRemote) seen.add(name);

      branches.push({
        name,
        isRemote,
        isDefault: displayName === defaultBranch,
      });
    }

    // Sort: default first, then local, then remote, alphabetical within each group
    branches.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return branches;
  }

  /**
   * List branches from a remote URL using git ls-remote.
   */
  async listRemoteBranches(url: string): Promise<BranchInfo[]> {
    const result = await $`git ls-remote --heads ${url}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list remote branches: ${result.stderr.toString()}`);
    }

    const output = result.stdout.toString().trim();
    if (!output) return [];

    const branches: BranchInfo[] = [];
    for (const line of output.split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 2) continue;
      const ref = parts[1].trim();
      // refs/heads/branch-name → branch-name
      const name = ref.replace("refs/heads/", "");
      branches.push({
        name,
        isRemote: true,
        isDefault: false, // Can't reliably detect default from ls-remote
      });
    }

    branches.sort((a, b) => a.name.localeCompare(b.name));
    return branches;
  }
```

**Step 2: Verify build**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/worktree-manager/index.ts
git commit -m "feat: add listBranches and listRemoteBranches to WorktreeManager"
```

---

### Task 3: Add REST endpoints for branch listing

**Files:**
- Modify: `packages/server/src/api/rest/repositories.ts`

**Step 1: Add GET /repositories/:repoId/branches endpoint**

Add this route after the `GET /repositories/:repoId/worktrees` route (after line 207):

```typescript
  app.get("/repositories/:repoId/branches", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = store.getRepository(repoId);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }
    try {
      const branches = await worktreeManager.listBranches(repo.path);
      return c.json(branches);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list branches";
      return c.json({ error: message }, 500);
    }
  });
```

**Step 2: Add POST /branches/remote endpoint**

Add this route after the previous new route:

```typescript
  app.post("/branches/remote", async (c) => {
    const body = await c.req.json<{ url: string }>();
    if (!body.url) {
      return c.json({ error: "url is required" }, 400);
    }
    try {
      const branches = await worktreeManager.listRemoteBranches(body.url);
      return c.json(branches);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list remote branches";
      return c.json({ error: message }, 500);
    }
  });
```

**Step 3: Verify build**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/api/rest/repositories.ts
git commit -m "feat: add branch listing REST endpoints"
```

---

### Task 4: Add SDK methods for branch listing

**Files:**
- Modify: `packages/sdk/src/client.ts`

**Step 1: Add import for BranchInfo**

Update the import at line 1 to include `BranchInfo`:

```typescript
import type {
  // ... existing imports ...
  BranchInfo,
} from "@matrix/protocol";
```

**Step 2: Add getBranches and getRemoteBranches methods**

Add these methods after the `deleteWorktree` method (after line 286):

```typescript
  async getBranches(repositoryId: string): Promise<BranchInfo[]> {
    const res = await this.fetch(`/repositories/${repositoryId}/branches`);
    if (!res.ok) {
      throw new Error(`Failed to get branches for ${repositoryId}: ${res.status}`);
    }
    return res.json();
  }

  async getRemoteBranches(url: string): Promise<BranchInfo[]> {
    const res = await this.fetch("/branches/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      throw new Error(`Failed to get remote branches: ${res.status}`);
    }
    return res.json();
  }
```

**Step 3: Verify build**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/sdk/src/client.ts
git commit -m "feat: add getBranches and getRemoteBranches to SDK client"
```

---

### Task 5: Install cmdk and create Popover + Command UI components

**Files:**
- Modify: `packages/client/package.json` (add `cmdk` dependency)
- Create: `packages/client/src/components/ui/popover.tsx`
- Create: `packages/client/src/components/ui/command.tsx`

**Step 1: Install cmdk**

Run: `cd packages/client && pnpm add cmdk`

**Step 2: Create Popover component**

Create `packages/client/src/components/ui/popover.tsx` (standard shadcn popover):

```tsx
import * as React from "react";
import * as PopoverPrimitive from "radix-ui/internal/PopoverPrimitive";
import { cn } from "@/lib/utils";

// Note: radix-ui package (already installed) bundles all primitives.
// Import from the radix-ui package directly.

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-md outline-hidden",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
```

**IMPORTANT:** The project uses `radix-ui` v1.4.3 (unified package). Check how other components import Radix primitives to match the pattern. For example, look at `select.tsx` imports. The import might be:
```typescript
// If select.tsx uses:
import { Select as SelectPrimitive } from "radix-ui";
// Then popover should use:
import { Popover as PopoverPrimitive } from "radix-ui";
```

Adapt the import style to match existing components in the project.

**Step 3: Create Command component**

Create `packages/client/src/components/ui/command.tsx`:

```tsx
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center border-b border-border px-3" data-slot="command-input-wrapper">
      <Search className="mr-2 size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty data-slot="command-empty" className="py-6 text-center text-sm" {...props} />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[data-slot=command-group-heading]]:px-2 [&_[data-slot=command-group-heading]]:py-1.5 [&_[data-slot=command-group-heading]]:text-xs [&_[data-slot=command-group-heading]]:font-medium [&_[data-slot=command-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
```

**Step 4: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/client/package.json packages/client/src/components/ui/popover.tsx packages/client/src/components/ui/command.tsx pnpm-lock.yaml
git commit -m "feat: add Popover and Command UI components with cmdk"
```

---

### Task 6: Create the BranchSelect component

**Files:**
- Create: `packages/client/src/components/ui/branch-select.tsx`

**Step 1: Create the component**

Create `packages/client/src/components/ui/branch-select.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, GitBranch, Loader2 } from "lucide-react";
import type { BranchInfo } from "@matrix/protocol";
import type { MatrixClient } from "@matrix/sdk";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

interface BranchSelectProps {
  /** Fetch branches for a local repository by ID */
  repositoryId?: string;
  /** Fetch branches from a remote URL (for clone dialog) */
  remoteUrl?: string;
  /** The Matrix SDK client */
  client: MatrixClient;
  /** Currently selected branch */
  value: string;
  /** Called when a branch is selected */
  onChange: (branch: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

export function BranchSelect({
  repositoryId,
  remoteUrl,
  client,
  value,
  onChange,
  placeholder = "Select branch...",
  className,
  "data-testid": testId,
}: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchBranches = async () => {
      try {
        let result: BranchInfo[];
        if (repositoryId) {
          result = await client.getBranches(repositoryId);
        } else if (remoteUrl) {
          result = await client.getRemoteBranches(remoteUrl);
        } else {
          result = [];
        }
        if (!cancelled) setBranches(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load branches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBranches();
    return () => { cancelled = true; };
  }, [open, repositoryId, remoteUrl, client]);

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  const displayValue = value || undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between rounded-lg font-normal",
            !displayValue && "text-muted-foreground",
            className,
          )}
          data-testid={testId}
        >
          <span className="flex items-center gap-2 truncate">
            <GitBranch className="size-3.5 shrink-0 opacity-50" />
            {displayValue || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="py-6 text-center text-sm text-destructive">{error}</div>
            )}
            {!loading && !error && (
              <>
                <CommandEmpty>No branches found.</CommandEmpty>
                {localBranches.length > 0 && (
                  <CommandGroup heading="Local">
                    {localBranches.map((branch) => (
                      <CommandItem
                        key={branch.name}
                        value={branch.name}
                        onSelect={() => {
                          onChange(branch.name);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            value === branch.name ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {branch.name}
                        {branch.isDefault && (
                          <span className="ml-auto text-xs text-muted-foreground">default</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {remoteBranches.length > 0 && (
                  <CommandGroup heading="Remote">
                    {remoteBranches.map((branch) => {
                      // For remote branches, use short name (without origin/) as the value
                      const shortName = branch.name.startsWith("origin/")
                        ? branch.name.slice("origin/".length)
                        : branch.name;
                      return (
                        <CommandItem
                          key={branch.name}
                          value={branch.name}
                          onSelect={() => {
                            onChange(shortName);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "size-3.5",
                              value === shortName ? "opacity-100" : "opacity-0",
                            )}
                          />
                          {branch.name}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

**Step 2: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/components/ui/branch-select.tsx
git commit -m "feat: add BranchSelect combobox component"
```

---

### Task 7: Integrate BranchSelect into NewWorktreeDialog

**Files:**
- Modify: `packages/client/src/components/worktree/NewWorktreeDialog.tsx`

**Step 1: Update imports and props**

The dialog currently receives `repository: RepositoryInfo` but doesn't have access to the `MatrixClient`. It needs the client to fetch branches.

Update the props interface to include `client`:

```typescript
import type { MatrixClient } from "@matrix/sdk";

interface NewWorktreeDialogProps {
  repository: RepositoryInfo;
  client: MatrixClient;
  onCreateWorktree: (repoId: string, branch: string, baseBranch: string) => Promise<void>;
  onClose: () => void;
}
```

Add import for BranchSelect:

```typescript
import { BranchSelect } from "@/components/ui/branch-select";
```

Update the destructured props:

```typescript
export function NewWorktreeDialog({
  repository,
  client,
  onCreateWorktree,
  onClose,
}: NewWorktreeDialogProps) {
```

**Step 2: Replace the Base branch `<Input>` with `<BranchSelect>`**

Replace lines 114-122 (the Base branch section inside CollapsibleContent):

```tsx
<CollapsibleContent>
  <div className="pt-1">
    <label className="mb-1.5 block text-sm font-medium">Base branch</label>
    <BranchSelect
      repositoryId={repository.id}
      client={client}
      value={baseBranch}
      onChange={setBaseBranch}
      placeholder={repository.defaultBranch}
      data-testid="worktree-base-branch-select"
    />
  </div>
</CollapsibleContent>
```

**Step 3: Update the call site in AppLayout.tsx**

In `packages/client/src/components/layout/AppLayout.tsx`, find where `NewWorktreeDialog` is rendered (around line 681-687) and add the `client` prop:

```tsx
{worktreeDialogRepo && client && (
  <NewWorktreeDialog
    repository={worktreeDialogRepo}
    client={client}
    onCreateWorktree={handleCreateWorktree}
    onClose={() => setWorktreeDialogRepo(null)}
  />
)}
```

The `client` variable is already available in the `AppContent` component from `useMatrixClient()`. Verify this by checking the component.

**Step 4: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/client/src/components/worktree/NewWorktreeDialog.tsx packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat: use BranchSelect for base branch in NewWorktreeDialog"
```

---

### Task 8: Integrate BranchSelect into CloneFromUrlDialog

**Files:**
- Modify: `packages/client/src/components/repository/CloneFromUrlDialog.tsx`

**Step 1: Add import**

```typescript
import { BranchSelect } from "@/components/ui/branch-select";
```

**Step 2: Replace the Branch `<Input>` with `<BranchSelect>`**

Replace lines 262-272 (the Branch section inside advanced options):

```tsx
<div>
  <label className="mb-1.5 block text-sm font-medium">
    Branch <span className="text-muted-foreground">(optional)</span>
  </label>
  <BranchSelect
    remoteUrl={url.trim() || undefined}
    client={client}
    value={branch}
    onChange={(v) => { setBranch(v); setValidationState({ type: "idle" }); }}
    placeholder="Default branch"
    data-testid="clone-branch-select"
  />
</div>
```

Note: The `BranchSelect` will use `remoteUrl` mode here. It will call `git ls-remote` when the popover opens. If `url` is empty, no branches will be fetched.

**Step 3: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/client/src/components/repository/CloneFromUrlDialog.tsx
git commit -m "feat: use BranchSelect for branch in CloneFromUrlDialog"
```

---

### Task 9: Verify full build and manual test

**Step 1: Full build check**

Run: `pnpm build` (from repo root)
Expected: All packages build successfully

**Step 2: Visual verification**

If dev server is running, check:
1. Open "Create Session" dialog → expand Advanced → "Base branch" should be a searchable dropdown
2. Open "Clone from URL" dialog → expand Advanced → "Branch" should be a searchable dropdown
3. Both dropdowns should show branches grouped by Local/Remote
4. Search/filter should work
5. Selecting a branch should populate the value

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address branch-select integration issues"
```
