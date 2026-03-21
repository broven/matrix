import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { AgentListItem, AgentEnvProfileSummary, AgentTestResult, AgentTestStep, CustomAgent, AgentEnvProfile } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import type { MatrixClient } from "@matrix/sdk";

// ── Env Editor ──────────────────────────────────────────────────

function shouldMaskValue(key: string): boolean {
  return /key|token|secret|password|credential/i.test(key);
}

interface EnvEditorProps {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}

function EnvEditor({ env, onChange }: EnvEditorProps) {
  const entries = Object.entries(env);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const addRow = () => {
    onChange({ ...env, "": "" });
  };

  const updateKey = (oldKey: string, newKey: string, index: number) => {
    const newEnv: Record<string, string> = {};
    let i = 0;
    for (const [k, v] of Object.entries(env)) {
      if (i === index) {
        newEnv[newKey] = v;
      } else {
        newEnv[k] = v;
      }
      i++;
    }
    onChange(newEnv);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...env, [key]: value });
  };

  const removeRow = (key: string) => {
    const { [key]: _, ...rest } = env;
    onChange(rest);
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {entries.map(([key, value], index) => {
        const masked = shouldMaskValue(key) && !revealedKeys.has(key);
        return (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={key}
              onChange={(e) => updateKey(key, e.target.value, index)}
              placeholder="KEY"
              className="w-1/3 rounded-lg font-mono text-xs"
            />
            <div className="relative flex-1">
              <Input
                value={masked ? "••••••••" : value}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder="value"
                className="rounded-lg font-mono text-xs pr-8"
                readOnly={masked}
              />
              {shouldMaskValue(key) && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleReveal(key)}
                >
                  {masked ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => removeRow(key)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="rounded-lg" onClick={addRow}>
        <Plus className="mr-1 size-3.5" />
        Add variable
      </Button>
    </div>
  );
}

// ── Test Step Results ────────────────────────────────────────────

function TestStepResults({ steps }: { steps: AgentTestStep[] }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
      {steps.map((step) => (
        <div key={step.name} className="flex items-center gap-2">
          {step.status === "pass" && <Check className="size-3.5 shrink-0 text-green-500" />}
          {step.status === "fail" && <X className="size-3.5 shrink-0 text-destructive" />}
          {step.status === "skipped" && <Minus className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className={step.status === "skipped" ? "text-muted-foreground" : ""}>
            {step.name}
          </span>
          {step.status !== "skipped" && (
            <span className="text-muted-foreground">({step.durationMs}ms)</span>
          )}
          {step.error && (
            <span className="text-destructive"> — {step.error}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Agent Dialog ────────────────────────────────────────────────

interface AgentDialogProps {
  title: string;
  initial?: { name: string; command: string; args: string[]; env?: Record<string, string>; description?: string };
  onSave: (data: { name: string; command: string; args: string[]; env?: Record<string, string>; description?: string }) => Promise<void>;
  onTest?: (config: { command: string; args: string[]; env?: Record<string, string> }) => Promise<AgentTestResult>;
  onClose: () => void;
}

function AgentDialog({ title, initial, onSave, onTest, onClose }: AgentDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [argsStr, setArgsStr] = useState(initial?.args?.join(" ") ?? "");
  const [env, setEnv] = useState<Record<string, string>>(initial?.env ?? {});
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim() && command.trim();
  const canTest = command.trim() && onTest;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
      const envToSave = Object.keys(env).length > 0 ? env : undefined;
      await onSave({ name: name.trim(), command: command.trim(), args, env: envToSave, description: description.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
      const envToSend = Object.keys(env).length > 0 ? env : undefined;
      const result = await onTest({ command: command.trim(), args, env: envToSend });
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test agent");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agent" className="rounded-lg" autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Command</label>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="/usr/local/bin/my-agent" className="rounded-lg font-mono text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Arguments</label>
            <Input value={argsStr} onChange={(e) => setArgsStr(e.target.value)} placeholder="--stdio --mode acp" className="rounded-lg font-mono text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Description (optional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A custom ACP agent" className="rounded-lg" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Environment variables</label>
            <EnvEditor env={env} onChange={setEnv} />
          </div>
          {testResult && <TestStepResults steps={testResult.steps} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>Cancel</Button>
            {onTest && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                disabled={testing || !canTest}
                onClick={handleTest}
                data-testid="test-agent-dialog-btn"
              >
                {testing ? (
                  <><Loader2 className="mr-1 size-3.5 animate-spin" />Testing...</>
                ) : (
                  <><Play className="mr-1 size-3.5" />Test</>
                )}
              </Button>
            )}
            <Button size="sm" className="rounded-lg" disabled={saving || !canSave} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profile Dialog ──────────────────────────────────────────────

interface ProfileDialogProps {
  title: string;
  initial?: { name: string; env: Record<string, string> };
  onSave: (data: { name: string; env: Record<string, string> }) => Promise<void>;
  onClose: () => void;
}

function ProfileDialog({ title, initial, onSave, onClose }: ProfileDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [env, setEnv] = useState<Record<string, string>>(initial?.env ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), env });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Profile name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" className="rounded-lg" autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Environment overrides</label>
            <EnvEditor env={env} onChange={setEnv} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="rounded-lg" disabled={saving || !canSave} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirmation ─────────────────────────────────────────

interface ConfirmDeleteDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

function ConfirmDeleteDialog({ title, message, onConfirm, onClose }: ConfirmDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" size="sm" className="rounded-lg" onClick={() => { onConfirm(); onClose(); }}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Agents Tab ─────────────────────────────────────────────

interface SettingsAgentsTabProps {
  agents: AgentListItem[];
  onRefreshAgents: () => void;
  client?: MatrixClient | null;
}

export function SettingsAgentsTab({ agents, onRefreshAgents, client: injectedClient }: SettingsAgentsTabProps) {
  const { client: contextClient } = useMatrixClient();
  const client = injectedClient ?? contextClient;
  // All agents with profiles are expanded by default
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() =>
    new Set(agents.filter((a) => a.profiles.length > 0).map((a) => a.id)),
  );
  const [dialog, setDialog] = useState<
    | null
    | { kind: "create-agent" }
    | { kind: "edit-agent"; agent: AgentListItem; fullAgent?: CustomAgent }
    | { kind: "fork-agent"; agent: AgentListItem; fullAgent?: CustomAgent }
    | { kind: "delete-agent"; agentId: string; agentName: string }
    | { kind: "create-profile"; parentAgentId: string }
    | { kind: "edit-profile"; profile: AgentEnvProfile }
    | { kind: "delete-profile"; profileId: string; profileName: string }
  >(null);

  // For editing profiles, we need full profile data (with env)
  const [editingProfile, setEditingProfile] = useState<AgentEnvProfile | null>(null);

  const toggleExpand = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  // Cache of full custom agent data (with args/env) keyed by agent id
  const [fullAgentCache, setFullAgentCache] = useState<Record<string, CustomAgent>>({});

  // Keep agents with profiles expanded when list updates
  useEffect(() => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      for (const a of agents) {
        if (a.profiles.length > 0) next.add(a.id);
      }
      return next;
    });
  }, [agents]);

  const builtinAgents = agents.filter((a) => a.source === "builtin");
  const customAgents = agents.filter((a) => a.source === "custom");

  const handleCreateAgent = async (data: { name: string; command: string; args: string[]; env?: Record<string, string>; description?: string }) => {
    if (!client) return;
    const created = await client.createCustomAgent(data);
    onRefreshAgents();
    setExpandedAgents((prev) => new Set(prev).add(created.id));
  };

  const handleEditAgent = async (agentId: string, data: { name: string; command: string; args: string[]; env?: Record<string, string>; description?: string }) => {
    if (!client) return;
    await client.updateCustomAgent(agentId, data);
    onRefreshAgents();
  };

  const handleForkAgent = async (data: { name: string; command: string; args: string[]; env?: Record<string, string>; description?: string }) => {
    if (!client) return;
    const created = await client.createCustomAgent(data);
    onRefreshAgents();
    // Auto-expand the newly forked agent
    setExpandedAgents((prev) => new Set(prev).add(created.id));
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!client) return;
    await client.deleteCustomAgent(agentId);
    onRefreshAgents();
  };

  const handleCreateProfile = async (parentAgentId: string, data: { name: string; env: Record<string, string> }) => {
    if (!client) return;
    await client.createAgentProfile({ parentAgentId, name: data.name, env: data.env });
    onRefreshAgents();
    // Auto-expand the parent agent to show the new profile
    setExpandedAgents((prev) => new Set(prev).add(parentAgentId));
  };

  const handleEditProfile = async (profileId: string, data: { name: string; env: Record<string, string> }) => {
    if (!client) return;
    await client.updateAgentProfile(profileId, data);
    onRefreshAgents();
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!client) return;
    await client.deleteAgentProfile(profileId);
    onRefreshAgents();
  };

  // Agent test state for inline testing from agent list rows
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [agentTestResults, setAgentTestResults] = useState<Record<string, AgentTestResult>>({});

  const handleTestAgent = async (config: { command: string; args: string[]; env?: Record<string, string> }) => {
    if (!client) throw new Error("Not connected");
    return client.testCustomAgent(config);
  };

  const handleTestAgentInline = async (agent: AgentListItem) => {
    if (!client) return;
    setTestingAgentId(agent.id);
    setAgentTestResults((prev) => {
      const next = { ...prev };
      delete next[agent.id];
      return next;
    });
    try {
      const full = await fetchFullAgent(agent.id);
      const result = await client.testCustomAgent({
        command: agent.command,
        args: full?.args ?? [],
        env: full?.env,
      });
      setAgentTestResults((prev) => ({ ...prev, [agent.id]: result }));
      // Auto-expand the agent to show results
      setExpandedAgents((prev) => new Set(prev).add(agent.id));
    } catch (err) {
      // Show a synthetic failed result so the user sees the error
      setAgentTestResults((prev) => ({
        ...prev,
        [agent.id]: {
          steps: [{ name: "spawn", status: "fail", durationMs: 0, error: err instanceof Error ? err.message : "Test request failed" }],
        },
      }));
      setExpandedAgents((prev) => new Set(prev).add(agent.id));
    } finally {
      setTestingAgentId(null);
    }
  };

  const fetchFullAgent = useCallback(async (agentId: string): Promise<CustomAgent | null> => {
    if (fullAgentCache[agentId]) return fullAgentCache[agentId];
    if (!client) return null;
    const all = await client.getCustomAgents();
    const map: Record<string, CustomAgent> = {};
    for (const a of all) map[a.id] = a;
    setFullAgentCache(map);
    return map[agentId] ?? null;
  }, [client, fullAgentCache]);

  const startEditAgent = async (agent: AgentListItem) => {
    const full = await fetchFullAgent(agent.id);
    setDialog({
      kind: "edit-agent",
      agent,
      ...(full ? { fullAgent: full } : {}),
    } as any);
  };

  const startForkAgent = async (agent: AgentListItem) => {
    const full = agent.source === "custom" ? await fetchFullAgent(agent.id) : null;
    setDialog({
      kind: "fork-agent",
      agent,
      ...(full ? { fullAgent: full } : {}),
    } as any);
  };

  const startEditProfile = async (profileSummary: AgentEnvProfileSummary) => {
    if (!client) return;
    // Fetch full profile with env data
    const profiles = await client.getAgentProfiles();
    const full = profiles.find((p) => p.id === profileSummary.id);
    if (full) {
      setEditingProfile(full);
      setDialog({ kind: "edit-profile", profile: full });
    }
  };

  const renderAgent = (agent: AgentListItem) => {
    const expanded = expandedAgents.has(agent.id);
    const hasProfiles = agent.profiles.length > 0;
    const isCustom = agent.source === "custom";

    return (
      <div key={agent.id} className="rounded-lg border border-border" data-testid={`agent-item-${agent.id}`}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Expand toggle */}
          {hasProfiles ? (
            <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => toggleExpand(agent.id)}>
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span className="size-4 shrink-0" />
          )}

          {/* Status dot */}
          <span className={`size-2 shrink-0 rounded-full ${agent.available ? "bg-green-500" : "bg-muted-foreground/40"}`} />

          {/* Name */}
          <span className="flex-1 truncate text-sm font-medium">
            {agent.name}
            {!agent.available && (
              <span className="ml-2 text-xs text-muted-foreground">(not installed)</span>
            )}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {!isCustom && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => startForkAgent(agent)}
                data-testid={`fork-agent-btn-${agent.id}`}
              >
                <Copy className="mr-1 size-3" />
                Fork
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setDialog({ kind: "create-profile", parentAgentId: agent.id })}
              data-testid={`add-profile-btn-${agent.id}`}
            >
              <Plus className="mr-1 size-3" />
              Profile
            </Button>
            {isCustom && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => handleTestAgentInline(agent)}
                  disabled={testingAgentId === agent.id}
                  data-testid={`test-agent-btn-${agent.id}`}
                >
                  {testingAgentId === agent.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => startEditAgent(agent)}
                  data-testid={`edit-agent-btn-${agent.id}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => setDialog({ kind: "delete-agent", agentId: agent.id, agentName: agent.name })}
                  data-testid={`delete-agent-btn-${agent.id}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Profiles */}
        {expanded && hasProfiles && (
          <div className="border-t border-border bg-muted/30">
            {agent.profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center gap-2 px-3 py-2 pl-10"
                data-testid={`profile-item-${profile.id}`}
              >
                <span className="flex-1 truncate text-sm text-muted-foreground">{profile.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => startEditProfile(profile)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => setDialog({ kind: "delete-profile", profileId: profile.id, profileName: profile.name })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Test results */}
        {agentTestResults[agent.id] && (
          <div className="border-t border-border p-3">
            <TestStepResults steps={agentTestResults[agent.id].steps} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6" data-testid="agents-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Agents</h3>
        <Button
          size="sm"
          className="rounded-lg"
          onClick={() => setDialog({ kind: "create-agent" })}
          data-testid="add-custom-agent-btn"
        >
          <Plus className="mr-1.5 size-3.5" />
          New Agent
        </Button>
      </div>

      {/* Built-in agents */}
      {builtinAgents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Built-in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {builtinAgents.map(renderAgent)}
          </CardContent>
        </Card>
      )}

      {/* Custom agents */}
      {customAgents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customAgents.map(renderAgent)}
          </CardContent>
        </Card>
      )}

      {agents.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No agents available. Add a custom agent to get started.
        </div>
      )}

      {/* Dialogs */}
      {dialog?.kind === "create-agent" && (
        <AgentDialog title="New Custom Agent" onSave={handleCreateAgent} onTest={handleTestAgent} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === "edit-agent" && (
        <AgentDialog
          title={`Edit ${dialog.agent.name}`}
          initial={{
            name: dialog.agent.name,
            command: dialog.agent.command,
            args: dialog.fullAgent?.args ?? [],
            env: dialog.fullAgent?.env ?? {},
            description: dialog.agent.description,
          }}
          onSave={(data) => handleEditAgent(dialog.agent.id, data)}
          onTest={handleTestAgent}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "fork-agent" && (
        <AgentDialog
          title={`Fork ${dialog.agent.name}`}
          initial={{
            name: `${dialog.agent.name} (Fork)`,
            command: dialog.agent.command,
            args: dialog.fullAgent?.args ?? [],
            env: dialog.fullAgent?.env ?? {},
            description: dialog.agent.description,
          }}
          onSave={handleForkAgent}
          onTest={handleTestAgent}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "delete-agent" && (
        <ConfirmDeleteDialog
          title="Delete Agent"
          message={`Are you sure you want to delete "${dialog.agentName}"? This will also delete all its profiles.`}
          onConfirm={() => handleDeleteAgent(dialog.agentId)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "create-profile" && (
        <ProfileDialog
          title="New Profile"
          onSave={(data) => handleCreateProfile(dialog.parentAgentId, data)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "edit-profile" && (
        <ProfileDialog
          title={`Edit ${dialog.profile.name}`}
          initial={{ name: dialog.profile.name, env: dialog.profile.env }}
          onSave={(data) => handleEditProfile(dialog.profile.id, data)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "delete-profile" && (
        <ConfirmDeleteDialog
          title="Delete Profile"
          message={`Are you sure you want to delete profile "${dialog.profileName}"?`}
          onConfirm={() => handleDeleteProfile(dialog.profileId)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
