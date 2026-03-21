import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, AvailableCommand, HistoryEntry, SessionInfo, SessionUpdate, ServerConfig } from "@matrix/protocol";
import type { MatrixSession, PromptCallbacks } from "@matrix/sdk";
import { nanoid } from "nanoid";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useServerClient } from "@/hooks/useMatrixClients";
import { MessageList, type SessionEvent } from "@/components/MessageList";
import { PromptInput } from "@/components/PromptInput";
import { StatusBar } from "@/components/chat/StatusBar";
import { ChatHeader } from "@/components/layout/ChatHeader";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot } from "lucide-react";

interface SessionViewProps {
  serverId: string;
  sessionInfo: SessionInfo;
  agents: AgentListItem[];
  onSessionInfoChange?: (sessionId: string, patch: Partial<SessionInfo>) => void;
  onNavigateSettings?: () => void;
  onResumeSession?: (sessionId: string) => Promise<void>;
}

type ViewStatus = "active" | "closed" | "restoring";

function isTerminalSessionError(code: string) {
  return code === "session_closed" || code === "session_unavailable" || code === "session_not_found";
}

function getInputPlaceholder(status: ViewStatus, hasAgent: boolean, noAgentAvailable: boolean) {
  if (status === "closed") return "This session is closed.";
  if (noAgentAvailable) return "No agents available. Go to Settings to install one.";
  if (!hasAgent) return "Select an agent to start...";
  return "Ask to make changes, @mention files, run /commands";
}

function getStatusMessage(status: ViewStatus, errorMessage: string | null) {
  if (errorMessage) return errorMessage;
  if (status === "closed") return "This session is closed. History remains available, but new prompts are disabled.";
  return null;
}

export function SessionView({ serverId, sessionInfo, agents, onSessionInfoChange, onNavigateSettings, onResumeSession }: SessionViewProps) {
  const { client: sidecarClient } = useMatrixClient();
  const { client: serverClient } = useServerClient(serverId);
  // Use the server-specific client if available, otherwise fall back to sidecar
  const client = serverClient ?? sidecarClient;
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewStatus, setViewStatus] = useState<ViewStatus>(
    sessionInfo.status === "closed" ? "closed" : "active",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(sessionInfo.agentId);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(sessionInfo.profileId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageQueue, setMessageQueue] = useState<{ text: string; agentId: string; profileId: string | null }[]>([]);
  const messageQueueRef = useRef<typeof messageQueue>([]);
  messageQueueRef.current = messageQueue;
  const sessionRef = useRef<MatrixSession | null>(null);
  const selectedAgentIdRef = useRef(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const selectedProfileIdRef = useRef(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;

  // Load default agent from server config if no agent selected
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  // Track the server's defaultAgent so ghost detection doesn't reset it
  const serverDefaultAgentRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedAgentId || !client) return;
    client.getServerConfig().then(async (config: ServerConfig) => {
      if (config.defaultAgent) {
        serverDefaultAgentRef.current = config.defaultAgent;
        // Check local agents list first
        const defaultExists = agentsRef.current.some(
          (a) => a.id === config.defaultAgent && a.available,
        );
        if (defaultExists) {
          setSelectedAgentId(config.defaultAgent);
          return;
        }
        // Custom agents may not be in the local list yet — refetch from server
        try {
          const freshAgents = await client.getAgents();
          if (freshAgents.some((a) => a.id === config.defaultAgent && a.available)) {
            setSelectedAgentId(config.defaultAgent);
            return;
          }
        } catch {
          // Fall through to fallback
        }
      }
      // Fall back to first available agent
      const firstAvailable = agentsRef.current.find((a) => a.available);
      if (firstAvailable) setSelectedAgentId(firstAvailable.id);
    }).catch(() => {
      const firstAvailable = agentsRef.current.find((a) => a.available);
      if (firstAvailable) setSelectedAgentId(firstAvailable.id);
    });
  }, [client, selectedAgentId]);

  // Ghost agent detection: reset if selected agent was uninstalled.
  // Only check once the agents list has been populated — an empty list
  // means agents are still loading, not that the selected one is gone.
  // Skip if the selected agent is the server's defaultAgent — it may be a
  // custom agent not yet in the local list (it was verified via server refetch).
  useEffect(() => {
    if (!selectedAgentId || agents.length === 0) return;
    if (selectedAgentId === serverDefaultAgentRef.current) return;
    const stillExists = agents.some((a) => a.id === selectedAgentId && a.available);
    if (!stillExists) {
      setSelectedAgentId(null);
      setSelectedProfileId(null);
      // If the session was agent-locked to this ghost agent, unlock it so user can pick a replacement
      if (sessionInfo.agentId === selectedAgentId) {
        onSessionInfoChange?.(sessionInfo.sessionId, { agentId: null });
      }
    }
  }, [agents, selectedAgentId, sessionInfo.agentId, sessionInfo.sessionId, onSessionInfoChange]);

  const addEvent = useCallback((type: string, data: SessionUpdate) => {
    setEvents((previous) => [
      ...previous,
      { id: nanoid(), type, data, timestamp: Date.now() },
    ]);
  }, []);

  const replaceEventsFromHistory = useCallback(
    (history: HistoryEntry[]) => {
      setEvents(
        history
          .filter((entry) => entry.type !== "completed")
          .map((entry) => {
            const timestamp = Date.parse(entry.timestamp) || Date.now();

            // Structured events: reconstruct from metadata
            if (entry.type !== "text" && entry.metadata) {
              return {
                id: entry.id,
                type: entry.type,
                data: entry.metadata as unknown as SessionUpdate,
                timestamp,
              };
            }

            // Text messages
            return {
              id: entry.id,
              type: "message",
              data: {
                sessionUpdate: "agent_message_chunk" as const,
                content: {
                  type: "text" as const,
                  text: entry.role === "user" ? `> ${entry.content}` : entry.content,
                },
              },
              timestamp,
            };
          }),
      );
    },
    [],
  );

  const drainQueue = useCallback(() => {
    const next = messageQueueRef.current[0];
    const currentSession = sessionRef.current;
    if (!next || !currentSession) return;

    // Remove from queue
    setMessageQueue((q) => q.slice(1));

    // Send the queued message using its captured agent/profile
    setIsProcessing(true);
    setErrorMessage(null);

    const callbacks: PromptCallbacks = {
      onComplete: () => setIsProcessing(false),
    };

    currentSession.promptWithContent(
      [{ type: "text", text: next.text, agentId: next.agentId, profileId: next.profileId ?? undefined }],
      callbacks,
    );
  }, []);

  useEffect(() => {
    setViewStatus(sessionInfo.status === "closed" ? "closed" : "active");
  }, [sessionInfo.sessionId, sessionInfo.status]);

  useEffect(() => {
    if (!client) return;

    setEvents([]);
    setIsProcessing(false);
    setErrorMessage(null);

    const attachedSession = client.attachSession(sessionInfo.sessionId);
    attachedSession.subscribe();
    setSession(attachedSession);
    sessionRef.current = attachedSession;

    const markActiveIfRestoring = () => {
      setViewStatus((prev) => {
        if (prev === "restoring") {
          onSessionInfoChange?.(sessionInfo.sessionId, {
            status: "active",
            suspendedAt: null,
            closeReason: null,
          });
          return "active";
        }
        return prev;
      });
    };

    const unsubscribe = attachedSession.subscribeToUpdates({
      onMessage: (chunk) => {
        markActiveIfRestoring();
        addEvent("message", { sessionUpdate: "agent_message_chunk", content: chunk });
      },
      onToolCall: (toolCall) => { markActiveIfRestoring(); addEvent("tool_call", toolCall); },
      onToolCallUpdate: (toolCall) => { markActiveIfRestoring(); addEvent("tool_call_update", toolCall); },
      onPermissionRequest: (request) => { markActiveIfRestoring(); addEvent("permission_request", request); },
      onPlan: (plan) => { markActiveIfRestoring(); addEvent("plan", plan); },
      onAvailableCommands: (commands) => setAvailableCommands(commands),
      onHistorySync: (history) => replaceEventsFromHistory(history),
      onSuspended: () => {
        // Agent suspended — session stays active, agent will be lazily restored
        setIsProcessing(false);
      },
      onRestoring: () => {
        setErrorMessage(null);
      },
      onComplete: () => {
        setIsProcessing(false);
        setViewStatus("active");
        setErrorMessage(null);
        onSessionInfoChange?.(sessionInfo.sessionId, {
          status: "active",
          lastActiveAt: new Date().toISOString(),
        });
        // Drain next queued message after a tick
        setTimeout(() => {
          if (messageQueueRef.current.length > 0) {
            drainQueue();
          }
        }, 0);
      },
      onError: (error: { code: string; message: string }) => {
        setIsProcessing(false);
        setErrorMessage(error.message);
        if (isTerminalSessionError(error.code)) {
          setViewStatus("closed");
          setMessageQueue([]);
          onSessionInfoChange?.(sessionInfo.sessionId, {
            status: "closed",
            closeReason: error.code,
          });
          return;
        }
        onSessionInfoChange?.(sessionInfo.sessionId, {
          lastActiveAt: new Date().toISOString(),
        });
        // Drain next queued message even after non-terminal errors to preserve FIFO
        setTimeout(() => {
          if (messageQueueRef.current.length > 0) {
            drainQueue();
          }
        }, 0);
      },
    });

    // Check for commands that may have arrived before callback registration
    if (attachedSession.availableCommands.length > 0) {
      setAvailableCommands(attachedSession.availableCommands);
    }

    void attachedSession.getHistory().then((history) => {
      replaceEventsFromHistory(history);
    });

    return unsubscribe;
  }, [addEvent, client, drainQueue, replaceEventsFromHistory, sessionInfo.sessionId]);

  const handleSend = useCallback(
    (text: string) => {
      if (!session || viewStatus === "closed") return;
      if (!selectedAgentId) {
        setErrorMessage("Please select an agent before sending a message.");
        return;
      }

      // Always show the user message immediately
      addEvent("message", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `> ${text}` },
      });

      if (isProcessing) {
        // Queue the message with its current agent/profile — it will be sent when current processing completes
        setMessageQueue((q) => [...q, { text, agentId: selectedAgentId, profileId: selectedProfileId }]);
        return;
      }

      setIsProcessing(true);
      setErrorMessage(null);

      const callbacks: PromptCallbacks = {
        onComplete: () => setIsProcessing(false),
      };

      session.promptWithContent(
        [{ type: "text", text, agentId: selectedAgentId, profileId: selectedProfileId ?? undefined }],
        callbacks,
      );
    },
    [addEvent, session, viewStatus, selectedAgentId, selectedProfileId, isProcessing],
  );

  const handleCancel = useCallback(() => {
    session?.cancel();
  }, [session]);

  const handleApprove = useCallback(
    (toolCallId: string, optionId: string) => {
      session?.approveToolCall(toolCallId, optionId);
    },
    [session],
  );

  const handleReject = useCallback(
    (toolCallId: string, optionId: string) => {
      session?.rejectToolCall(toolCallId, optionId);
    },
    [session],
  );

  const handleResume = useCallback(async () => {
    if (!onResumeSession) return;
    try {
      await onResumeSession(sessionInfo.sessionId);
      setViewStatus("active");
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to resume session");
    }
  }, [onResumeSession, sessionInfo.sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const availableAgents = agents.filter((a) => a.available);
  const noAgentAvailable = availableAgents.length === 0;
  const hasAgent = Boolean(sessionInfo.agentId || selectedAgentId);
  const statusMessage = getStatusMessage(viewStatus, errorMessage);
  const statusBarStatus = errorMessage
    ? "error"
    : viewStatus === "closed"
      ? "closed"
      : isProcessing
        ? "working"
        : "idle";
  const queuedTexts = useMemo(() => new Set(messageQueue.map((m) => m.text)), [messageQueue]);
  const inputDisabled = viewStatus === "closed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        isProcessing={isProcessing}
        session={sessionInfo}
        sessionStatus={viewStatus}
        statusMessage={statusMessage}
      />
      <ScrollArea className="min-h-0 flex-1">
        {noAgentAvailable && events.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Bot className="size-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-medium">No agents available</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Install an agent in Settings to start chatting.
                </p>
              </div>
              {onNavigateSettings && (
                <button
                  type="button"
                  onClick={onNavigateSettings}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  data-testid="go-to-settings-btn"
                >
                  Go to Settings
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <MessageList events={events} onApprove={handleApprove} onReject={handleReject} queuedTexts={queuedTexts} />
            <div ref={messagesEndRef} />
          </>
        )}
      </ScrollArea>
      <StatusBar status={statusBarStatus} message={statusMessage} onCancel={handleCancel} />
      {viewStatus === "closed" && sessionInfo.agentSessionId && onResumeSession && (
        <div className="flex justify-center border-t px-4 py-3">
          <button
            type="button"
            onClick={handleResume}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="resume-session-btn"
          >
            Resume conversation
          </button>
        </div>
      )}
      {viewStatus !== "closed" && (
        <PromptInput
          onSend={handleSend}
          disabled={inputDisabled}
          placeholder={getInputPlaceholder(viewStatus, hasAgent, noAgentAvailable)}
          isProcessing={isProcessing}
          agents={agents}
          selectedAgentId={selectedAgentId}
          selectedProfileId={selectedProfileId}
          onAgentChange={setSelectedAgentId}
          onProfileChange={setSelectedProfileId}
          availableCommands={availableCommands}
          agentLocked={Boolean(sessionInfo.agentId && agents.some((a) => a.id === sessionInfo.agentId && a.available))}
          noAgentAvailable={noAgentAvailable}
        />
      )}
    </div>
  );
}
