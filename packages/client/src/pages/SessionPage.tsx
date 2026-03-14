import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";
import { MessageList, type SessionEvent } from "../components/MessageList";
import { PromptInput } from "../components/PromptInput";
import type { MatrixSession, PromptCallbacks } from "@matrix/sdk";
import type { SessionInfo, SessionUpdate } from "@matrix/protocol";
import { nanoid } from "nanoid";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { client } = useMatrixClient();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const addEvent = useCallback((type: string, data: SessionUpdate) => {
    setEvents((prev) => [...prev, { id: nanoid(), type, data, timestamp: Date.now() }]);
  }, []);

  const replaceEventsFromHistory = useCallback((history: Array<{ id: string; role: "user" | "agent"; content: string; timestamp: string }>) => {
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
  }, []);

  useEffect(() => {
    if (!client || !sessionId) {
      navigate("/");
    }
  }, [client, sessionId, navigate]);

  useEffect(() => {
    if (!client || !sessionId) {
      return;
    }

    const attachedSession = client.attachSession(sessionId);
    attachedSession.subscribe();
    setSession(attachedSession);

    const unsubscribe = attachedSession.subscribeToUpdates({
      onMessage: (chunk) =>
        addEvent("message", { sessionUpdate: "agent_message_chunk", content: chunk }),
      onToolCall: (tc) => addEvent("tool_call", tc),
      onToolCallUpdate: (tc) => addEvent("tool_call_update", tc),
      onPermissionRequest: (req) => addEvent("permission_request", req),
      onPlan: (plan) => addEvent("plan", plan),
      onHistorySync: (history) => replaceEventsFromHistory(history),
      onComplete: () => setIsProcessing(false),
    });

    void client.getSessions().then((items) => {
      setSessionInfo(items.find((item) => item.sessionId === sessionId) ?? null);
    });

    void attachedSession.getHistory().then((history) => {
      replaceEventsFromHistory(history);
    });

    return unsubscribe;
  }, [client, sessionId, addEvent, replaceEventsFromHistory]);

  const handleSend = useCallback((text: string) => {
    if (!session) return;
    setIsProcessing(true);
    addEvent("message", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `> ${text}` },
    });

    const callbacks: PromptCallbacks = {
      onComplete: () => setIsProcessing(false),
    };

    session.prompt(text, callbacks);
  }, [session, addEvent]);

  const handleApprove = useCallback((toolCallId: string, optionId: string) => {
    session?.approveToolCall(toolCallId, optionId);
  }, [session]);

  const handleReject = useCallback((toolCallId: string, optionId: string) => {
    session?.rejectToolCall(toolCallId, optionId);
  }, [session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate("/dashboard")} style={{ cursor: "pointer" }}>Back</button>
        <span style={{ fontFamily: "monospace", fontSize: 14 }}>Session: {sessionId}</span>
        {sessionInfo && (
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {sessionInfo.agentId} @ {sessionInfo.cwd}
          </span>
        )}
        {isProcessing && <span style={{ color: "#3b82f6", fontSize: 13 }}>Processing...</span>}
      </header>

      <MessageList events={events} onApprove={handleApprove} onReject={handleReject} />
      <div ref={messagesEndRef} />

      <PromptInput onSend={handleSend} disabled={isProcessing} />
    </div>
  );
}
