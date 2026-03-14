import { useMemo, useState } from "react";
import type { AgentListItem, ConnectionStatus, SessionInfo } from "@matrix/protocol";
import { FolderSearch2, Plus, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionItem } from "@/components/layout/SessionItem";

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
      <div className="space-y-5 px-5 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Workspace
            </div>
            <div className="text-2xl font-semibold tracking-tight text-gradient">Matrix</div>
          </div>
          <Badge
            variant={connectionStatus === "connected" ? "default" : "secondary"}
            className="rounded-full px-3 py-1"
          >
            {connectionStatus}
          </Badge>
        </div>

        {sessions.length > 5 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              className="pl-9"
            />
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="space-y-1 pb-4">
          {filteredSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-sidebar-border bg-background/60 px-4 py-6 text-center">
              <FolderSearch2 className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No sessions found</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Create a new session or adjust the search filter.
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

      <div className="space-y-4 border-t border-sidebar-border px-5 py-5">
        <Button
          className="w-full justify-start rounded-xl"
          onClick={() => setShowCreateForm((current) => !current)}
          variant={showCreateForm ? "secondary" : "default"}
        >
          <Plus className="size-4" />
          New Session
        </Button>

        {showCreateForm ? (
          <div className="space-y-3 rounded-2xl border border-sidebar-border bg-background/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Launch a fresh agent session</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Sessions appear immediately in the sidebar and auto-open after creation.
              </p>
            </div>
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="w-full">
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
            />
            <Button
              className="w-full"
              disabled={creating || !selectedAgent || !cwd.trim()}
              onClick={handleCreate}
            >
              {creating ? "Creating..." : "Create Session"}
            </Button>
          </div>
        ) : null}

        <Separator />

        <div className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
          <Sparkles className="size-4 text-primary" />
          Responsive sidebar on desktop, drawer navigation on mobile.
        </div>
      </div>
    </div>
  );
}
