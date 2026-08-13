import { useEffect, useMemo, useState } from 'react';
import { Search, Code2, Cloud, Copy, Check, FileJson, FileText, X, Loader2, RotateCcw, History as HistoryIcon, GitCompare } from 'lucide-react';
import CodeMirror, { EditorView, ViewPlugin, Decoration, MatchDecorator } from '@uiw/react-codemirror';
import { diffLines } from 'diff';
import { supabase } from '../lib/supabase';
import {
  AI_PROMPTS_REGISTRY,
  AI_PROMPT_TOTAL,
  getAiPromptCountBySource,
  type AiPromptEntry,
  type PromptSource,
} from '../lib/ai-prompts-registry';

type SourceFilter = 'all' | PromptSource;
type OverrideRow = { system_prompt: string | null; user_prompt: string | null; updated_at: string };
type Draft = { system: string; user: string };
type VersionRow = { id: string; system_prompt: string | null; user_prompt: string | null; created_at: string; created_by: string | null };

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string; icon: React.ReactNode }> = [
  { id: 'all', label: 'All', icon: null },
  { id: 'supabase-function', label: 'Functions', icon: <Code2 size={12} /> },
  { id: 'cloudflare-worker', label: 'Workers', icon: <Cloud size={12} /> },
];

// Highlights `{tokenName}` placeholders — the actual dynamic-token syntax used by the
// two ask-vendor-email prompts (the only editable text with real interpolation points;
// everywhere else, runtime data is appended by code after the editable prefix).
const variableMatcher = new MatchDecorator({
  regexp: /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g,
  decoration: () => Decoration.mark({ class: 'ai-prompt-variable' }),
});
const variableHighlightPlugin = ViewPlugin.define(
  (view) => ({
    decorations: variableMatcher.createDeco(view),
    update(update) {
      this.decorations = variableMatcher.updateDeco(update, this.decorations);
    },
  }),
  { decorations: (v) => v.decorations },
);
const variableHighlightTheme = EditorView.baseTheme({
  '.ai-prompt-variable': { color: '#8b5cf6', fontWeight: '600' },
});
const editorExtensions = [variableHighlightPlugin, variableHighlightTheme, EditorView.lineWrapping];

function SourceBadge({ source }: { source: PromptSource }) {
  const isCf = source === 'cloudflare-worker';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        isCf ? 'border border-orange-200 bg-orange-50 text-orange-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {isCf ? <Cloud size={9} /> : <Code2 size={9} />}
      {isCf ? 'Worker' : 'Function'}
    </span>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-700">
      <span className="font-semibold text-gray-400">{label}</span>
      {value}
    </span>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2.5 text-[10px] leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? 'bg-emerald-50 text-emerald-700'
              : part.removed
                ? 'bg-red-50 text-red-700 line-through'
                : 'text-gray-700'
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-500 hover:bg-gray-50"
    >
      {copied ? <Check size={9} className="text-emerald-600" /> : <Copy size={9} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function AdminAiPromptsPanel() {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({});
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [overridesError, setOverridesError] = useState('');

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<VersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const countsBySource = useMemo(() => getAiPromptCountBySource(), []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const loadOverrides = async () => {
    setOverridesLoading(true);
    setOverridesError('');
    try {
      const { data, error } = await supabase.functions.invoke('admin-ai-prompts', {
        body: { password: sessionStorage.getItem('admin_authed') || '', action: 'list' },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to load prompt overrides');
      const byKey: Record<string, OverrideRow> = {};
      for (const row of (data?.prompts ?? []) as Array<{ prompt_key: string } & OverrideRow>) {
        byKey[row.prompt_key] = { system_prompt: row.system_prompt, user_prompt: row.user_prompt, updated_at: row.updated_at };
      }
      setOverrides(byKey);
    } catch (err) {
      setOverridesError((err as Error).message);
    } finally {
      setOverridesLoading(false);
    }
  };

  useEffect(() => {
    void loadOverrides();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AI_PROMPTS_REGISTRY
      .filter((entry) => {
        if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
        if (!q) return true;
        return (
          entry.name.toLowerCase().includes(q)
          || entry.description.toLowerCase().includes(q)
          || entry.location.toLowerCase().includes(q)
          || entry.handler.toLowerCase().includes(q)
          || entry.systemPrompt?.toLowerCase().includes(q)
          || entry.userPrompt.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.source === b.source) return 0;
        return a.source === 'cloudflare-worker' ? -1 : 1;
      });
  }, [query, sourceFilter]);

  useEffect(() => {
    if ((!selectedId || !filtered.some((e) => e.id === selectedId)) && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(() => AI_PROMPTS_REGISTRY.find((e) => e.id === selectedId) ?? null, [selectedId]);

  const draftFor = (entry: AiPromptEntry): Draft => {
    const existing = drafts[entry.id];
    if (existing) return existing;
    const override = overrides[entry.id];
    return {
      system: override?.system_prompt ?? entry.systemPrompt ?? '',
      user: override?.user_prompt ?? entry.userPrompt,
    };
  };

  const updateDraft = (entry: AiPromptEntry, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [entry.id]: { ...draftFor(entry), ...patch } }));
  };

  const selectRow = (entry: AiPromptEntry) => {
    setSelectedId(entry.id);
    setDrafts((prev) => (prev[entry.id] ? prev : { ...prev, [entry.id]: draftFor(entry) }));
    setShowDiff(false);
    setShowHistory(false);
  };

  const loadHistory = async (promptKey: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const { data, error } = await supabase.functions.invoke('admin-ai-prompts', {
        body: { password: sessionStorage.getItem('admin_authed') || '', action: 'history', prompt_key: promptKey },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to load history');
      setHistory((data?.versions ?? []) as VersionRow[]);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (showHistory && selected) void loadHistory(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, selected?.id]);

  const applyVersion = (version: VersionRow) => {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected.id]: { system: version.system_prompt ?? '', user: version.user_prompt ?? '' } }));
    setShowHistory(false);
  };

  const handleSave = async (entry: AiPromptEntry) => {
    const draft = draftFor(entry);
    setSavingId(entry.id);
    setRowErrors((prev) => ({ ...prev, [entry.id]: '' }));
    try {
      const { data, error } = await supabase.functions.invoke('admin-ai-prompts', {
        body: {
          password: sessionStorage.getItem('admin_authed') || '',
          action: 'save',
          prompt_key: entry.id,
          system_prompt: entry.systemPrompt !== undefined ? (draft.system.trim() || null) : null,
          user_prompt: draft.user.trim() || null,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Save failed');
      setOverrides((prev) => ({
        ...prev,
        [entry.id]: { system_prompt: data.prompt.system_prompt, user_prompt: data.prompt.user_prompt, updated_at: data.prompt.updated_at },
      }));
      setSavedId(entry.id);
      setTimeout(() => setSavedId((cur) => (cur === entry.id ? null : cur)), 1500);
      if (showHistory) void loadHistory(entry.id);
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [entry.id]: (err as Error).message }));
    } finally {
      setSavingId(null);
    }
  };

  const handleReset = async (entry: AiPromptEntry) => {
    setSavingId(entry.id);
    setRowErrors((prev) => ({ ...prev, [entry.id]: '' }));
    try {
      const { data, error } = await supabase.functions.invoke('admin-ai-prompts', {
        body: { password: sessionStorage.getItem('admin_authed') || '', action: 'reset', prompt_key: entry.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Reset failed');
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [entry.id]: (err as Error).message }));
    } finally {
      setSavingId(null);
    }
  };

  const selectedDraft = selected ? draftFor(selected) : null;
  const selectedOverride = selected ? overrides[selected.id] : undefined;
  const isDirty = !!selected && !!selectedDraft && (
    selectedDraft.system !== (selectedOverride?.system_prompt ?? selected.systemPrompt ?? '')
    || selectedDraft.user !== (selectedOverride?.user_prompt ?? selected.userPrompt)
  );

  return (
    <div className="mt-4 flex h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-gray-200">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Code2 size={14} className="text-gray-500" />
            <h2 className="text-xs font-semibold text-gray-900">AI Prompts</h2>
          </div>
          <div className="flex items-center gap-1">
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-600">{AI_PROMPT_TOTAL}</span>
            {overridesLoading && <Loader2 size={11} className="animate-spin text-gray-400" />}
          </div>
        </div>

        {overridesError && (
          <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[10px] text-red-700">
            <span className="truncate">{overridesError}</span>
            <button type="button" onClick={() => void loadOverrides()} className="shrink-0 font-semibold underline">Retry</button>
          </div>
        )}

        <div className="border-b border-gray-200 p-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts..."
              className="h-7 w-full rounded-md border border-gray-300 bg-white pl-7 pr-6 text-[11px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                <X size={11} />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            {SOURCE_FILTERS.map((filter) => {
              const isActive = sourceFilter === filter.id;
              const count = filter.id === 'all' ? AI_PROMPT_TOTAL : countsBySource[filter.id as PromptSource] ?? 0;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSourceFilter(filter.id)}
                  className={`inline-flex h-6 flex-1 items-center justify-center gap-1 rounded px-1.5 text-[10px] font-semibold transition ${
                    isActive ? 'border border-blue-600 bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {filter.icon}
                  {filter.label}
                  <span className={isActive ? 'text-blue-100' : 'text-gray-400'}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <FileText size={18} />
              <p className="mt-2 text-[10px]">No prompts match.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((entry) => {
                const isSelected = entry.id === selectedId;
                const isOverridden = !!overrides[entry.id];
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => selectRow(entry)}
                      className={`flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition ${
                        isSelected ? 'border-blue-600 bg-blue-50' : 'border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <span
                        title={isOverridden ? 'Customized' : 'Default'}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOverridden ? 'bg-amber-500' : 'bg-gray-300'}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-900">{entry.name}</span>
                      {entry.source === 'cloudflare-worker'
                        ? <Cloud size={10} className="shrink-0 text-orange-500" />
                        : <Code2 size={10} className="shrink-0 text-emerald-500" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Detail workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected || !selectedDraft ? (
          <div className="flex flex-1 items-center justify-center text-xs text-gray-400">Select a prompt to view</div>
        ) : (
          <>
            <div className="border-b border-gray-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{selected.name}</h3>
                <SourceBadge source={selected.source} />
                {selected.jsonOutput && (
                  <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                    <FileJson size={9} /> JSON
                  </span>
                )}
                {selectedOverride ? (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-600">Default</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">{selected.description}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <MetaChip label="Model" value={selected.model} />
                {selected.temperature !== undefined && <MetaChip label="Temp" value={String(selected.temperature)} />}
                {selected.maxTokens !== undefined && <MetaChip label="Max Tokens" value={String(selected.maxTokens)} />}
                <MetaChip label="Handler" value={selected.handler} />
                <MetaChip label="Location" value={selected.location} />
              </div>
              {selected.notes && <p className="mt-1.5 text-[10px] text-gray-400">{selected.notes}</p>}
              {selectedOverride && (
                <p className="mt-1 text-[10px] text-gray-400">Last edited {new Date(selectedOverride.updated_at).toLocaleString()}</p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {showHistory ? (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Version History</span>
                    {historyLoading && <Loader2 size={11} className="animate-spin text-gray-400" />}
                  </div>
                  {historyError && <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{historyError}</div>}
                  {!historyLoading && history.length === 0 && !historyError && (
                    <p className="text-[11px] text-gray-400">No saved edits yet for this prompt.</p>
                  )}
                  <ul className="space-y-1.5">
                    {history.map((version) => (
                      <li key={version.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-600">
                          {new Date(version.created_at).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => applyVersion(version)}
                          className="shrink-0 rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100"
                        >
                          Load into draft
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-3">
                  {selected.systemPrompt !== undefined && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">System Prompt</span>
                        <CopyButton text={selectedDraft.system} />
                      </div>
                      {showDiff ? (
                        <DiffView before={selected.systemPrompt ?? ''} after={selectedDraft.system} />
                      ) : (
                        <CodeMirror
                          value={selectedDraft.system}
                          onChange={(v) => updateDraft(selected, { system: v })}
                          theme={isDark ? 'dark' : 'light'}
                          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, autocompletion: false }}
                          extensions={editorExtensions}
                          minHeight="120px"
                          maxHeight="320px"
                          className="overflow-hidden rounded-md border border-gray-200 text-[11px]"
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">User Prompt</span>
                      <CopyButton text={selectedDraft.user} />
                    </div>
                    {showDiff ? (
                      <DiffView before={selected.userPrompt} after={selectedDraft.user} />
                    ) : (
                      <CodeMirror
                        value={selectedDraft.user}
                        onChange={(v) => updateDraft(selected, { user: v })}
                        theme={isDark ? 'dark' : 'light'}
                        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, autocompletion: false }}
                        extensions={editorExtensions}
                        minHeight="120px"
                        maxHeight="320px"
                        className="overflow-hidden rounded-md border border-gray-200 text-[11px]"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5">
              <button
                type="button"
                onClick={() => void handleSave(selected)}
                disabled={savingId === selected.id}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingId === selected.id ? <Loader2 size={10} className="animate-spin" /> : savedId === selected.id ? <Check size={10} /> : null}
                {savedId === selected.id ? 'Saved' : 'Save'}
              </button>
              {selectedOverride && (
                <button
                  type="button"
                  onClick={() => void handleReset(selected)}
                  disabled={savingId === selected.id}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  <RotateCcw size={10} /> Revert to Default
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowDiff((v) => !v); setShowHistory(false); }}
                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[10px] font-semibold ${
                  showDiff ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <GitCompare size={10} /> {showDiff ? 'Hide Diff' : 'View Diff'}
              </button>
              <button
                type="button"
                onClick={() => { setShowHistory((v) => !v); setShowDiff(false); }}
                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[10px] font-semibold ${
                  showHistory ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <HistoryIcon size={10} /> History
              </button>
              {isDirty && <span className="text-[10px] font-semibold text-amber-600">Unsaved changes</span>}
              {rowErrors[selected.id] && <span className="text-[10px] text-red-600">{rowErrors[selected.id]}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
