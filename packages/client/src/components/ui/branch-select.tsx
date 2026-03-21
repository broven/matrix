import { useState, useEffect } from "react"
import { Check, ChevronsUpDown, GitBranch, Loader2 } from "lucide-react"
import type { BranchInfo } from "@matrix/protocol"
import type { MatrixClient } from "@matrix/sdk"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"

interface BranchSelectProps {
  /** Fetch branches for a local repository by ID */
  repositoryId?: string
  /** Fetch branches from a remote URL (for clone dialog) */
  remoteUrl?: string
  /** The Matrix SDK client */
  client: MatrixClient
  /** Currently selected branch */
  value: string
  /** Called when a branch is selected */
  onChange: (branch: string) => void
  placeholder?: string
  className?: string
  "data-testid"?: string
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
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchBranches = async () => {
      try {
        let result: BranchInfo[]
        if (repositoryId) {
          result = await client.getBranches(repositoryId)
        } else if (remoteUrl) {
          result = await client.getRemoteBranches(remoteUrl)
        } else {
          result = []
        }
        if (!cancelled) setBranches(result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load branches")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchBranches()
    return () => { cancelled = true }
  }, [open, repositoryId, remoteUrl, client])

  const localBranches = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)

  const displayValue = value || undefined

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
                          onChange(branch.name)
                          setOpen(false)
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
                      const shortName = branch.name.startsWith("origin/")
                        ? branch.name.slice("origin/".length)
                        : branch.name
                      return (
                        <CommandItem
                          key={branch.name}
                          value={branch.name}
                          onSelect={() => {
                            onChange(shortName)
                            setOpen(false)
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
                      )
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
