'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/button';
import type { ChatSettings, ChatSummary, ModelInfo, ToolPolicy } from '../adapters/types';
import type { Capabilities } from '../adapters/capabilities';
import { resolveActiveModel } from '../model/resolve-model';
export interface SettingsPanelProps {
  open: boolean; onClose: () => void; chat: ChatSummary; models: ModelInfo[]; capabilities: Capabilities;
  onChange: (patch: { model?: string; settings?: Partial<ChatSettings> }) => void; onSaveDefaults: () => void;
}

function Num({ id, label, value, min, max, step, onCommit }: { id: string; label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n); else setV(String(value));
  };
  return (
    <label className="block text-xs text-chat-muted">
      <span className="mb-1 block">{label}</span>
      <input id={id} type="number" aria-label={label} min={min} max={max} step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-sm text-chat-fg" />
    </label>
  );
}

export function SettingsPanel(p: SettingsPanelProps) {
  const [skills, setSkills] = useState<string[]>([]);
  useEffect(() => { let on = true; void p.capabilities.listSkills().then((s) => { if (on) setSkills(s); }); return () => { on = false; }; }, [p.capabilities]);
  const [prompt, setPrompt] = useState(p.chat.settings.system_prompt);
  useEffect(() => setPrompt(p.chat.settings.system_prompt), [p.chat.settings.system_prompt]);
  if (!p.open) return null;
  const s = p.chat.settings;
  // The same two rules <ChatApp> picks between, so the panel never describes a
  // different model than the composer is using. The single-model fallback is
  // the host's opt-in (`modelSelection: 'host'`); otherwise this is the 0.1.2
  // lookup — plus the backend's own word (`model_loaded: false`, #240), which
  // beats a catalog that has not been re-polled since the model went away.
  const model = p.capabilities.modelSelection === 'host'
    ? resolveActiveModel(p.models, p.chat.model)
    : p.chat.model_loaded === false ? null : p.models.find((m) => m.id === p.chat.model) ?? null;
  // The chat's stored model, which is NOT constrained to the loaded set: it can
  // be unloaded or replaced long after the chat was created. When nothing
  // resolves for it the <select> must still carry it as an option — a value
  // matching no option makes the browser display the FIRST option instead,
  // indistinguishable from a real choice, on a chat that will then refuse to
  // send (#240). Under the host's single-model fallback the resolved model is
  // the one in use, so that is the truthful value to show.
  const pinned = p.chat.model;
  const pinnedUnavailable = !!pinned && model === null;
  const selectValue = model?.id ?? pinned ?? '';
  const loadedOptions = pinnedUnavailable ? p.models.filter((m) => m.id !== pinned) : p.models;
  const efforts = model?.reasoning_efforts ?? [];
  const effort = s.reasoning_effort ?? '';
  const tools = p.capabilities.listTools();
  return (
    <aside className="flex h-full w-72 flex-col gap-4 overflow-y-auto border-l border-chat-rule bg-chat-page/50 p-3 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:bg-chat-page" aria-label="Chat settings">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-chat-accent-strong">Settings</h2>
        <Button variant="ghost" size="sm" aria-label="Close settings" onClick={p.onClose}><X className="h-4 w-4" aria-hidden /></Button>
      </div>
      <label className="block text-xs text-chat-muted">
        <span className="mb-1 block">Model</span>
        <select aria-label="Model" value={selectValue} onChange={(e) => p.onChange({ model: e.target.value })} className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg">
          {!pinned && <option value="">— pick a model —</option>}
          {pinnedUnavailable ? (
            <>
              <optgroup label="Not loaded">
                <option value={pinned} disabled>{pinned} (not loaded)</option>
              </optgroup>
              <optgroup label="Loaded">
                {loadedOptions.map((m) => <option key={m.id} value={m.id}>{m.display}</option>)}
              </optgroup>
            </>
          ) : (
            loadedOptions.map((m) => <option key={m.id} value={m.id}>{m.display}</option>)
          )}
        </select>
        {pinnedUnavailable && (
          <div role="status" className="mt-1 text-[11px] text-chat-warn">
            {loadedOptions.length > 0
              ? 'This chat is pinned to a model that is not loaded. Pick a loaded one to continue.'
              : 'This chat is pinned to a model that is not loaded, and nothing else is loaded yet.'}
          </div>
        )}
        {model && (
          <div className="mt-1 text-[11px] text-chat-dim">
            {model.context_window ? `${model.context_window.toLocaleString()} tokens` : 'context unknown'}
            {' · '}
            {[model.supports_tools && 'tools', model.supports_vision && 'vision', model.supports_reasoning && 'reasoning'].filter(Boolean).join(', ') || 'text only'}
            {model.pricing ? ` · $${(model.pricing.input_micros_per_1k / 1e6).toFixed(4)}/$${(model.pricing.output_micros_per_1k / 1e6).toFixed(4)} per 1k` : ''}
          </div>
        )}
      </label>
      <Num id="temp" label="Temperature" value={s.temperature} min={0} max={2} step={0.05} onCommit={(v) => p.onChange({ settings: { temperature: v } })} />
      <Num id="maxtok" label="Max tokens" value={s.max_tokens} min={1} max={131072} step={64} onCommit={(v) => p.onChange({ settings: { max_tokens: v } })} />
      <Num id="topp" label="Top p" value={s.top_p} min={0} max={1} step={0.05} onCommit={(v) => p.onChange({ settings: { top_p: v } })} />
      {model?.supports_reasoning && (
        <label className="flex items-center gap-2 text-xs text-chat-muted">
          {/* absent === on: the backend only ever persists an explicit false */}
          <input type="checkbox" aria-label="Enable thinking" checked={s.enable_thinking !== false}
            onChange={(e) => p.onChange({ settings: { enable_thinking: e.target.checked } })} />
          <span>Enable thinking</span>
        </label>
      )}
      {model?.supports_reasoning && efforts.length > 0 && (
        <label className="block text-xs text-chat-muted">
          <span className="mb-1 block">Reasoning effort</span>
          {/* The options are the model's own vocabulary, verbatim from the
              backend — nothing here knows what the levels are called. Inert
              while thinking is off: the backend does not forward it then. */}
          <select aria-label="Reasoning effort" value={effort} disabled={s.enable_thinking === false}
            onChange={(e) => p.onChange({ settings: { reasoning_effort: e.target.value } })}
            className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg disabled:opacity-50">
            <option value="">Model default</option>
            {efforts.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
            {/* A level stored under a different model: shown as what it is,
                never as one of this model's levels. The backend drops it. */}
            {effort && !efforts.includes(effort) && <option value={effort} disabled>{effort} (not offered by this model)</option>}
          </select>
        </label>
      )}
      {p.capabilities.systemPrompt !== 'hidden' && (
        <label className="block text-xs text-chat-muted">
          <span className="mb-1 block">System prompt</span>
          <textarea aria-label="System prompt" readOnly={p.capabilities.systemPrompt === 'readonly'} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => { if (prompt !== s.system_prompt) p.onChange({ settings: { system_prompt: prompt } }); }} rows={5}
            className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-xs text-chat-fg" />
        </label>
      )}
      {tools.length > 0 && (
        <fieldset className="text-xs text-chat-muted">
          <legend className="mb-1">Tools</legend>
          {tools.map((t) => (
            <label key={t.name} className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled_tools.includes(t.name)} disabled={model ? !model.supports_tools : true}
                onChange={(e) => p.onChange({ settings: { enabled_tools: e.target.checked ? [...s.enabled_tools, t.name] : s.enabled_tools.filter((n) => n !== t.name) } })} />
              {' '}<span className="font-mono">{t.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      {skills.length > 0 && (
        <fieldset className="text-xs text-chat-muted">
          <legend className="mb-1">Skills</legend>
          {skills.map((sk) => (
            <label key={sk} className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled_skills.includes(sk)}
                onChange={(e) => p.onChange({ settings: { enabled_skills: e.target.checked ? [...s.enabled_skills, sk] : s.enabled_skills.filter((n) => n !== sk) } })} />
              {' '}{sk}
            </label>
          ))}
        </fieldset>
      )}
      {p.capabilities.toolPolicy === 'editable' && (
        <fieldset className="text-xs text-chat-muted">
          <legend className="mb-1">Tool policy</legend>
          <Num id="maxiter" label="Max tool iterations" value={s.tool_policy?.max_iterations ?? 8} min={1} max={24} step={1}
            onCommit={(v) => p.onChange({ settings: { tool_policy: { max_iterations: v, tool_choice: s.tool_policy?.tool_choice ?? 'auto' } } })} />
          <label className="mt-1 block">
            <span className="mb-1 block">Tool choice</span>
            <select aria-label="Tool choice" value={s.tool_policy?.tool_choice ?? 'auto'}
              onChange={(e) => p.onChange({ settings: { tool_policy: { max_iterations: s.tool_policy?.max_iterations ?? 8, tool_choice: e.target.value as ToolPolicy['tool_choice'] } } })}
              className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg">
              <option value="auto">auto</option><option value="none">none</option><option value="required">required</option>
            </select>
          </label>
          <p className="mt-1 text-[11px] text-chat-dim">When the budget runs out the agent always answers once more without tools.</p>
        </fieldset>
      )}
      <div className="mt-auto">
        <Button variant="outline" size="sm" className="w-full" onClick={p.onSaveDefaults}>Save as my defaults</Button>
        <p className="mt-1 text-[11px] text-chat-dim">Changes apply to the next turn and are snapshotted on each message.</p>
      </div>
    </aside>
  );
}
