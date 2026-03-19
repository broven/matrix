import { useState } from "react";
import type { AgentListItem, RepositoryInfo } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

interface NewWorktreeDialogProps {
  repository: RepositoryInfo;
  agents: AgentListItem[];
  defaultAgentId?: string;
  onCreateWorktree: (
    repoId: string,
    branch: string,
    baseBranch: string,
    agentId: string,
    taskDescription?: string,
  ) => Promise<void>;
  onClose: () => void;
}

export function NewWorktreeDialog({
  repository,
  agents,
  defaultAgentId,
  onCreateWorktree,
  onClose,
}: NewWorktreeDialogProps) {
  const [branch, setBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState(repository.defaultBranch);
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents.find((a) => a.available)?.id ?? "");
  const [taskDescription, setTaskDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableAgents = agents.filter((a) => a.available);

  const handleCreate = async () => {
    if (!branch.trim() || !baseBranch.trim() || !agentId) return;

    setCreating(true);
    setError(null);
    try {
      await onCreateWorktree(
        repository.id,
        branch.trim(),
        baseBranch.trim(),
        agentId,
        taskDescription.trim() || undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create worktree");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4">
          <div>
            <h2 className="text-lg font-semibold">New Worktree</h2>
            <p className="text-sm text-muted-foreground">{repository.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Branch name</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feat/my-feature"
              className="rounded-lg"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Base branch</label>
            <Input
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder={repository.defaultBranch}
              className="rounded-lg"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9 rounded-lg">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Task description <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="What should the agent work on?"
              className="min-h-[80px] rounded-lg text-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-lg"
              disabled={creating || !branch.trim() || !baseBranch.trim() || !agentId}
              onClick={handleCreate}
            >
              {creating ? "Creating..." : "Create Worktree"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
