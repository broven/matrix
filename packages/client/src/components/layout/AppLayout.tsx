import { useEffect, useMemo, useState } from "react";
import type { AgentListItem, SessionInfo } from "@matrix/protocol";
import { MessageSquarePlus } from "lucide-react";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { SessionView } from "@/components/chat/SessionView";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsPage } from "@/pages/SettingsPage";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Settings } from "lucide-react";

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
  const [showSettings, setShowSettings] = useState(false);

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
      <aside className="hidden h-full w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
        <Sidebar
          agents={agents}
          sessions={sortedSessions}
          connectionStatus={status}
          selectedSessionId={selectedSessionId}
          onSelectSession={(sessionId) => setSelectedSessionId(sessionId)}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg text-xs"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="size-3.5" />
            Settings
          </Button>
        </div>
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[300px] border-sidebar-border bg-sidebar p-0">
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
        {showSettings ? (
          <SettingsPage onBack={() => setShowSettings(false)} />
        ) : (
        <>
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
            <div className="max-w-sm space-y-5 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                <MessageSquarePlus className="size-5" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight">No session selected</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Pick a session from the sidebar or create a new one.
                </p>
              </div>
              <Button
                className="rounded-xl"
                onClick={() => setMobileSidebarOpen(true)}
                variant="outline"
                size="sm"
              >
                Open Sessions
              </Button>
            </div>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}
