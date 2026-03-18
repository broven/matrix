import { useMemo, useState } from "react";
import type { AgentListItem, ConnectionStatus, SessionInfo } from "@matrix/protocol";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionItem } from "@/components/layout/SessionItem";
import { cn } from "@/lib/utils";

interface SidebarProps {
  agents: AgentListItem[];
  sessions: SessionInfo[];
  connectionStatus: ConnectionStatus;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (agentId: string, cwd: string) => Promise<string | null>;
  onDeleteSession: (sessionId: string) => void;
}

export function Sidebar({
  agents,
  sessions,
  connectionStatus,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [cwd, setCwd] = useState("");
  const [creating, setCreating] = useState(false);

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.available),
    [agents],
  );

  const filteredSessions = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return sessions;

    return sessions.filter((session) => {
      return (
        session.agentId.toLowerCase().includes(value) ||
        session.cwd.toLowerCase().includes(value) ||
        session.sessionId.toLowerCase().includes(value) ||
        session.status.toLowerCase().includes(value)
      );
    });
  }, [query, sessions]);

  const handleCreate = async () => {
    if (!selectedAgent || !cwd.trim()) return;

    setCreating(true);
    try {
      const sessionId = await onCreateSession(selectedAgent, cwd.trim());
      if (sessionId) {
        setSelectedAgent("");
        setCwd("");
        setShowCreateForm(false);
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="space-y-4 px-4 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <span className="text-sm font-bold">M</span>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Matrix</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Workspace
              </div>
            </div>
          </div>
          <div
            className={cn(
              "size-2 rounded-full",
              connectionStatus === "connected" ? "bg-success" : "bg-muted-foreground/40",
            )}
            title={connectionStatus}
          />
        </div>

        {sessions.length > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              className="h-8 rounded-lg border-border/50 bg-background pl-8 text-sm"
            />
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="space-y-0.5 pb-4">
          {filteredSessions.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No sessions</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Create one to get started.
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                selected={session.sessionId === selectedSessionId}
                onSelect={() => onSelectSession(session.sessionId)}
                onDelete={onDeleteSession}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-sidebar-border px-4 py-4">
        <Button
          className="w-full justify-center gap-2 rounded-xl text-sm"
          onClick={() => setShowCreateForm((current) => !current)}
          variant={showCreateForm ? "secondary" : "default"}
          size="sm"
        >
          <Plus className="size-4" />
          New Session
        </Button>

        {showCreateForm && (
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-background p-3">
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="h-8 w-full rounded-lg text-sm">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Working directory"
              className="h-8 rounded-lg text-sm"
            />
            <Button
              className="w-full rounded-lg"
              size="sm"
              disabled={creating || !selectedAgent || !cwd.trim()}
              onClick={handleCreate}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
