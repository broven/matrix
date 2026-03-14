import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo, SessionUpdate } from "@matrix/protocol";
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
  onSessionInfoChange?: (sessionId: string, patch: Partial<SessionInfo>) => void;
}

type ViewStatus = SessionInfo["status"];

function isTerminalSessionError(code: string) {
  return code === "session_closed" || code === "session_unavailable" || code === "session_not_found";
}

function getInputPlaceholder(status: ViewStatus) {
  switch (status) {
    case "active":
      return "Message the active session...";
    case "suspended":
      return "Send a message to resume this session...";
    case "restoring":
      return "Restoring session...";
    case "closed":
      return "This session is closed.";
  }
}

function getStatusMessage(status: ViewStatus, errorMessage: string | null) {
  if (errorMessage) return errorMessage;

  switch (status) {
    case "active":
      return null;
    case "suspended":
      return "This session is suspended to save memory. Sending a message will restore it.";
    case "restoring":
      return "Restoring agent state before sending your message.";
    case "closed":
      return "This session is closed. History remains available, but new prompts are disabled.";
  }
}

export function SessionView({ sessionInfo, onSessionInfoChange }: SessionViewProps) {
  const { client } = useMatrixClient();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewStatus, setViewStatus] = useState<ViewStatus>(sessionInfo.status);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addEvent = useCallback((type: string, data: SessionUpdate) => {
    setEvents((previous) => [
      ...previous,
      { id: nanoid(), type, data, timestamp: Date.now() },
    ]);
  }, []);

  const replaceEventsFromHistory = useCallback(
    (history: Array<{ id: string; role: "user" | "agent"; content: string; timestamp: string }>) => {
      setEvents(
        history.map((entry) => ({
          id: entry.id,
          type: "message",
          data: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: entry.role === "user" ? `> ${entry.content}` : entry.content,
            },
          },
          timestamp: Date.parse(entry.timestamp) || Date.now(),
        })),
      );
    },
    [],
  );

  useEffect(() => {
    setViewStatus(sessionInfo.status);
  }, [sessionInfo.sessionId, sessionInfo.status]);

  useEffect(() => {
    if (!client) return;

    setEvents([]);
    setIsProcessing(false);
    setErrorMessage(null);

    const attachedSession = client.attachSession(sessionInfo.sessionId);
    attachedSession.subscribe();
    setSession(attachedSession);

    const unsubscribe = attachedSession.subscribeToUpdates({
      onMessage: (chunk) =>
        addEvent("message", { sessionUpdate: "agent_message_chunk", content: chunk }),
      onToolCall: (toolCall) => addEvent("tool_call", toolCall),
      onToolCallUpdate: (toolCall) => addEvent("tool_call_update", toolCall),
      onPermissionRequest: (request) => addEvent("permission_request", request),
      onPlan: (plan) => addEvent("plan", plan),
      onHistorySync: (history) => replaceEventsFromHistory(history),
      onSuspended: () => {
        setIsProcessing(false);
        setViewStatus("suspended");
        onSessionInfoChange?.(sessionInfo.sessionId, {
          status: "suspended",
          suspendedAt: new Date().toISOString(),
        });
      },
      onRestoring: () => {
        setViewStatus("restoring");
        setErrorMessage(null);
        onSessionInfoChange?.(sessionInfo.sessionId, {
          status: "restoring",
          closeReason: null,
        });
      },
      onComplete: () => {
        setIsProcessing(false);
        setViewStatus("active");
        setErrorMessage(null);
        onSessionInfoChange?.(sessionInfo.sessionId, {
          status: "active",
          suspendedAt: null,
          closeReason: null,
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

    void attachedSession.getHistory().then((history) => {
      replaceEventsFromHistory(history);
    });

    return unsubscribe;
  }, [addEvent, client, replaceEventsFromHistory, sessionInfo.sessionId]);

  const handleSend = useCallback(
    (text: string) => {
      if (!session || viewStatus === "closed" || viewStatus === "restoring") return;

      setIsProcessing(true);
      setErrorMessage(null);
      addEvent("message", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `> ${text}` },
      });

      const callbacks: PromptCallbacks = {
        onComplete: () => setIsProcessing(false),
      };

      session.prompt(text, callbacks);
    },
    [addEvent, session, viewStatus],
  );

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

  const statusMessage = getStatusMessage(viewStatus, errorMessage);
  const statusBarStatus = errorMessage
    ? "error"
    : viewStatus === "restoring"
      ? "restoring"
      : viewStatus === "suspended"
        ? "suspended"
        : viewStatus === "closed"
          ? "closed"
          : isProcessing
            ? "working"
            : "idle";
  const inputDisabled = isProcessing || viewStatus === "restoring" || viewStatus === "closed";

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
      <StatusBar status={statusBarStatus} message={statusMessage} />
      <PromptInput
        onSend={handleSend}
        disabled={inputDisabled}
        placeholder={getInputPlaceholder(viewStatus)}
      />
    </div>
  );
}
