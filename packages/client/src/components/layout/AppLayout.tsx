import { useEffect, useMemo, useState } from "react";
import type { AgentListItem, SessionInfo } from "@matrix/protocol";
import { PanelLeftOpen, Plus } from "lucide-react";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { SessionView } from "@/components/chat/SessionView";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const SESSION_STATUS_ORDER: Record<SessionInfo["status"], number> = {
  active: 0,
  restoring: 1,
  suspended: 2,
  closed: 3,
};

function sortSessions(sessions: SessionInfo[]) {
  return [...sessions].sort((left, right) => {
    const statusDiff = SESSION_STATUS_ORDER[left.status] - SESSION_STATUS_ORDER[right.status];
    if (statusDiff !== 0) return statusDiff;

    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

export function AppLayout() {
  const { client, status } = useMatrixClient();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!client) {
      setAgents([]);
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const [agentItems, sessionItems] = await Promise.all([
          client.getAgents(),
          client.getSessions(),
        ]);

        if (cancelled) return;

        setAgents(agentItems);
        setSessions(sessionItems);
      } catch (error) {
        console.error("Failed to load layout data:", error);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [client, status]);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (selectedSessionId && sessions.some((session) => session.sessionId === selectedSessionId)) {
      return;
    }

    const nextSession =
      sortSessions(sessions).find((session) => session.status !== "closed") ??
      sortSessions(sessions)[0] ??
      null;

    if (!nextSession) {
      return;
    }

    setSelectedSessionId(nextSession.sessionId);
  }, [selectedSessionId, sessions]);

  const sortedSessions = useMemo(() => sortSessions(sessions), [sessions]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const handleSessionInfoChange = (sessionId: string, patch: Partial<SessionInfo>) => {
    setSessions((previous) =>
      previous.map((session) =>
        session.sessionId === sessionId ? { ...session, ...patch } : session,
      ),
    );
  };

  const handleRefreshSessions = async () => {
    if (!client) return;

    try {
      const sessionItems = await client.getSessions();
      setSessions(sessionItems);
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!client) return;

    setSessions((previous) => previous.filter((s) => s.sessionId !== sessionId));

    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
    }

    try {
      await client.deleteSession(sessionId);
    } catch (error) {
      console.error("Failed to delete session:", error);
      void handleRefreshSessions();
    }
  };

  const handleCreateSession = async (agentId: string, cwd: string) => {
    if (!client) return null;

    const session = await client.createSession({ agentId, cwd });
    const optimisticSession: SessionInfo = {
      sessionId: session.sessionId,
      agentId,
      cwd,
      createdAt: new Date().toISOString(),
      status: "active",
      recoverable: false,
      agentSessionId: null,
      lastActiveAt: new Date().toISOString(),
      suspendedAt: null,
      closeReason: null,
    };

    setSessions((previous) => {
      const remaining = previous.filter((item) => item.sessionId !== session.sessionId);
      return [optimisticSession, ...remaining];
    });
    setSelectedSessionId(session.sessionId);
    setMobileSidebarOpen(false);

    void handleRefreshSessions();

    return session.sessionId;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden h-full w-[280px] shrink-0 border-r border-sidebar-border bg-sidebar md:flex">
        <Sidebar
          agents={agents}
          sessions={sortedSessions}
          connectionStatus={status}
          selectedSessionId={selectedSessionId}
          onSelectSession={(sessionId) => setSelectedSessionId(sessionId)}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[320px] border-sidebar-border bg-sidebar p-0">
          <Sidebar
            agents={agents}
            sessions={sortedSessions}
            connectionStatus={status}
            selectedSessionId={selectedSessionId}
            onSelectSession={(sessionId) => {
              setSelectedSessionId(sessionId);
              setMobileSidebarOpen(false);
            }}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <MobileHeader
          selectedSession={selectedSession}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        {selectedSession ? (
          <SessionView
            key={selectedSession.sessionId}
            sessionInfo={selectedSession}
            onSessionInfoChange={handleSessionInfoChange}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md space-y-4 rounded-[1.75rem] border border-dashed border-border bg-card/70 p-8 text-center shadow-sm">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <PanelLeftOpen className="size-6" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">No session selected</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Pick a session from the sidebar or create a new one to open the chat view.
                </p>
              </div>
              <Button
                className="w-full sm:w-auto"
                onClick={() => setMobileSidebarOpen(true)}
                variant="outline"
              >
                <Plus className="size-4" />
                Open Sessions
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
