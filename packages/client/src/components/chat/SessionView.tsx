import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentListItem, AvailableCommand, HistoryEntry, SessionInfo, SessionUpdate, ServerConfig } from "@matrix/protocol";
import type { MatrixSession, PromptCallbacks } from "@matrix/sdk";
import { nanoid } from "nanoid";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { MessageList, type SessionEvent } from "@/components/MessageList";
import { PromptInput } from "@/components/PromptInput";
import { StatusBar } from "@/components/chat/StatusBar";
import { ChatHeader } from "@/components/layout/ChatHeader";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SessionViewProps {
  sessionInfo: SessionInfo;
  agents: AgentListItem[];
  onSessionInfoChange?: (sessionId: string, patch: Partial<SessionInfo>) => void;
}

type ViewStatus = "active" | "closed";

function isTerminalSessionError(code: string) {
  return code === "session_closed" || code === "session_unavailable" || code === "session_not_found";
}

function getInputPlaceholder(status: ViewStatus, hasAgent: boolean) {
  if (status === "closed") return "This session is closed.";
  if (!hasAgent) return "Select an agent and send a message to start...";
  return "Ask to make changes, @mention files, run /commands";
}

function getStatusMessage(status: ViewStatus, errorMessage: string | null) {
  if (errorMessage) return errorMessage;
  if (status === "closed") return "This session is closed. History remains available, but new prompts are disabled.";
  return null;
}

export function SessionView({ sessionInfo, agents, onSessionInfoChange }: SessionViewProps) {
  const { client } = useMatrixClient();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewStatus, setViewStatus] = useState<ViewStatus>(
    sessionInfo.status === "closed" ? "closed" : "active",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(sessionInfo.agentId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load default agent from server config if no agent selected
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    if (selectedAgentId || !client) return;
    client.getServerConfig().then((config: ServerConfig) => {
      if (config.defaultAgent) {
        setSelectedAgentId(config.defaultAgent);
      } else {
        // Fall back to first available agent
        const firstAvailable = agentsRef.current.find((a) => a.available);
        if (firstAvailable) setSelectedAgentId(firstAvailable.id);
      }
    }).catch(() => {
      const firstAvailable = agentsRef.current.find((a) => a.available);
      if (firstAvailable) setSelectedAgentId(firstAvailable.id);
    });
  }, [client, selectedAgentId]);

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
      },
      onError: (error: { code: string; message: string }) => {
        setIsProcessing(false);
        setErrorMessage(error.message);
        if (isTerminalSessionError(error.code)) {
          setViewStatus("closed");
          onSessionInfoChange?.(sessionInfo.sessionId, {
            status: "closed",
            closeReason: error.code,
          });
          return;
        }
        onSessionInfoChange?.(sessionInfo.sessionId, {
          lastActiveAt: new Date().toISOString(),
        });
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
  }, [addEvent, client, replaceEventsFromHistory, sessionInfo.sessionId]);

  const handleSend = useCallback(
    (text: string) => {
      if (!session || viewStatus === "closed") return;
      if (!selectedAgentId) {
        setErrorMessage("Please select an agent before sending a message.");
        return;
      }

      setIsProcessing(true);
      setErrorMessage(null);
      addEvent("message", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `> ${text}` },
      });

      const callbacks: PromptCallbacks = {
        onComplete: () => setIsProcessing(false),
      };

      // Include agentId in the prompt for lazy initialization
      session.promptWithContent(
        [{ type: "text", text, agentId: selectedAgentId }],
        callbacks,
      );
    },
    [addEvent, session, viewStatus, selectedAgentId],
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const hasAgent = Boolean(sessionInfo.agentId || selectedAgentId);
  const statusMessage = getStatusMessage(viewStatus, errorMessage);
  const statusBarStatus = errorMessage
    ? "error"
    : viewStatus === "closed"
      ? "closed"
      : isProcessing
        ? "working"
        : "idle";
  const inputDisabled = isProcessing || viewStatus === "closed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        isProcessing={isProcessing}
        session={sessionInfo}
        sessionStatus={viewStatus}
        statusMessage={statusMessage}
      />
      <ScrollArea className="min-h-0 flex-1">
        <MessageList events={events} onApprove={handleApprove} onReject={handleReject} />
        <div ref={messagesEndRef} />
      </ScrollArea>
      <StatusBar status={statusBarStatus} message={statusMessage} onCancel={handleCancel} />
      <PromptInput
        onSend={handleSend}
        disabled={inputDisabled}
        placeholder={getInputPlaceholder(viewStatus, hasAgent)}
        isProcessing={isProcessing}
        agents={agents}
        selectedAgentId={selectedAgentId}
        onAgentChange={setSelectedAgentId}
        availableCommands={availableCommands}
      />
    </div>
  );
}
