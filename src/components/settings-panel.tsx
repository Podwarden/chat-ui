'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/button';
import type { ChatSettings, ChatSummary, ModelInfo, ToolPolicy } from '../adapters/types';
import type { Capabilities } from '../adapters/capabilities';
import { resolveActiveModel } from '../model/resolve-model';
import { SELECTION_DELAY_MAX_MS, SELECTION_DELAY_MIN_MS, type SelectionPrefs } from '../model/prefs';
import { useChatLabels } from '../app/labels-context';
export interface SettingsPanelProps {
  open: boolean; onClose: () => void; chat: ChatSummary; models: ModelInfo[]; capabilities: Capabilities;
  onChange: (patch: { model?: string; settings?: Partial<ChatSettings> }) => void; onSaveDefaults: () => void;
  /**
   * The text-selection preferences (per browser, see `model/prefs.ts`). With
   * both this and `onSelectionPrefsChange` the panel shows its "Text
   * selection" section; without them it is not rendered.
   */
  selectionPrefs?: SelectionPrefs;
  onSelectionPrefsChange?: (patch: Partial<SelectionPrefs>) => void;
  /**
   * Always an overlay over the transcript, whatever the viewport. `<ChatApp>`
   * sets it in its compact layout: a 400 px widget on a desktop screen is past
   * the `md` breakpoint, and a 288 px column beside the transcript would leave
   * the transcript nothing.
   */
  overlay?: boolean;
}

/** "Text selection": the menu's on/off switch, then its delay and what Explain does. */
function SelectionSection({ prefs, onChange }: { prefs: SelectionPrefs; onChange: (patch: Partial<SelectionPrefs>) => void }) {
  const { labels: { settings: l } } = useChatLabels();
  return (
    <fieldset className="text-xs text-chat-muted" aria-label={l.textSelection}>
      <legend className="mb-1 font-mono uppercase tracking-wider text-chat-accent-strong">{l.textSelection}</legend>
      <label className="flex items-center gap-2">
        <input type="checkbox" role="switch" aria-checked={prefs.enabled} aria-label={l.showSelectionMenu} checked={prefs.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span>{l.showSelectionMenu}</span>
      </label>
      <div className={`mt-2 space-y-2 pl-5 ${prefs.enabled ? '' : 'opacity-50'}`}>
        <Num id="seldelay" label={l.menuDelay} value={prefs.delayMs} min={SELECTION_DELAY_MIN_MS} max={SELECTION_DELAY_MAX_MS} step={50}
          disabled={!prefs.enabled} onCommit={(v) => onChange({ delayMs: v })} />
        <label className="block">
          <span className="mb-1 block">{l.explain}</span>
          <select aria-label={l.explainBehaviour} value={prefs.explainMode} disabled={!prefs.enabled}
            onChange={(e) => onChange({ explainMode: e.target.value as SelectionPrefs['explainMode'] })}
            className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg">
            <option value="send">{l.explainSend}</option>
            <option value="prefill">{l.explainPrefill}</option>
          </select>
        </label>
      </div>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" aria-label={l.quoteAsChips} checked={prefs.quoteAsChips}
          onChange={(e) => onChange({ quoteAsChips: e.target.checked })} />
        <span>{l.quoteAsChips}</span>
      </label>
      <p className="mt-1 text-[11px] text-chat-dim">{l.selectionHint}</p>
    </fieldset>
  );
}

function Num({ id, label, value, min, max, step, onCommit, disabled }: { id: string; label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n); else setV(String(value));
  };
  return (
    <label className="block text-xs text-chat-muted">
      <span className="mb-1 block">{label}</span>
      <input id={id} type="number" aria-label={label} disabled={disabled} min={min} max={max} step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-sm text-chat-fg" />
    </label>
  );
}

export function SettingsPanel(p: SettingsPanelProps) {
  const { labels: { settings: l }, format } = useChatLabels();
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
    <aside className={p.overlay
      ? 'absolute inset-y-0 right-0 z-10 flex h-full w-72 max-w-full flex-col gap-4 overflow-y-auto border-l border-chat-rule bg-chat-page p-3 shadow-xl'
      : 'flex h-full w-72 flex-col gap-4 overflow-y-auto border-l border-chat-rule bg-chat-page/50 p-3 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:bg-chat-page'} aria-label={l.region} data-chat-overlay={p.overlay ? '' : undefined}>
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-chat-accent-strong">{l.heading}</h2>
        <Button variant="ghost" size="sm" aria-label={l.close} onClick={p.onClose}><X className="h-4 w-4" aria-hidden /></Button>
      </div>
      <label className="block text-xs text-chat-muted">
        <span className="mb-1 block">{l.model}</span>
        <select aria-label={l.model} value={selectValue} onChange={(e) => p.onChange({ model: e.target.value })} className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg">
          {!pinned && <option value="">{l.pickModel}</option>}
          {pinnedUnavailable ? (
            <>
              <optgroup label={l.notLoadedGroup}>
                <option value={pinned} disabled>{l.notLoadedOption(pinned)}</option>
              </optgroup>
              <optgroup label={l.loadedGroup}>
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
              ? l.pinnedNotLoaded
              : l.pinnedNotLoadedNoneLoaded}
          </div>
        )}
        {model && (
          <div className="mt-1 text-[11px] text-chat-dim">
            {model.context_window ? l.contextTokens(model.context_window, format.number(model.context_window)) : l.contextUnknown}
            {' · '}
            {[model.supports_tools && l.capabilityTools, model.supports_vision && l.capabilityVision, model.supports_reasoning && l.capabilityReasoning].filter(Boolean).join(', ') || l.textOnly}
            {model.pricing ? ` · ${l.pricePer1k(format.usd(model.pricing.input_micros_per_1k / 1e6, 4), format.usd(model.pricing.output_micros_per_1k / 1e6, 4))}` : ''}
          </div>
        )}
      </label>
      <Num id="temp" label={l.temperature} value={s.temperature} min={0} max={2} step={0.05} onCommit={(v) => p.onChange({ settings: { temperature: v } })} />
      <Num id="maxtok" label={l.maxTokens} value={s.max_tokens} min={1} max={131072} step={64} onCommit={(v) => p.onChange({ settings: { max_tokens: v } })} />
      <Num id="topp" label={l.topP} value={s.top_p} min={0} max={1} step={0.05} onCommit={(v) => p.onChange({ settings: { top_p: v } })} />
      {model?.supports_reasoning && (
        <label className="flex items-center gap-2 text-xs text-chat-muted">
          {/* absent === on: the backend only ever persists an explicit false */}
          <input type="checkbox" aria-label={l.enableThinking} checked={s.enable_thinking !== false}
            onChange={(e) => p.onChange({ settings: { enable_thinking: e.target.checked } })} />
          <span>{l.enableThinking}</span>
        </label>
      )}
      {model?.supports_reasoning && efforts.length > 0 && (
        <label className="block text-xs text-chat-muted">
          <span className="mb-1 block">{l.reasoningEffort}</span>
          {/* The options are the model's own vocabulary, verbatim from the
              backend — nothing here knows what the levels are called. Inert
              while thinking is off: the backend does not forward it then. */}
          <select aria-label={l.reasoningEffort} value={effort} disabled={s.enable_thinking === false}
            onChange={(e) => p.onChange({ settings: { reasoning_effort: e.target.value } })}
            className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg disabled:opacity-50">
            <option value="">{l.modelDefault}</option>
            {efforts.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
            {/* A level stored under a different model: shown as what it is,
                never as one of this model's levels. The backend drops it. */}
            {effort && !efforts.includes(effort) && <option value={effort} disabled>{l.effortNotOffered(effort)}</option>}
          </select>
        </label>
      )}
      {p.capabilities.systemPrompt !== 'hidden' && (
        <label className="block text-xs text-chat-muted">
          <span className="mb-1 block">{l.systemPrompt}</span>
          <textarea aria-label={l.systemPrompt} readOnly={p.capabilities.systemPrompt === 'readonly'} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => { if (prompt !== s.system_prompt) p.onChange({ settings: { system_prompt: prompt } }); }} rows={5}
            className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-xs text-chat-fg" />
        </label>
      )}
      {tools.length > 0 && (
        <fieldset className="text-xs text-chat-muted">
          <legend className="mb-1">{l.tools}</legend>
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
          <legend className="mb-1">{l.skills}</legend>
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
          <legend className="mb-1">{l.toolPolicy}</legend>
          <Num id="maxiter" label={l.maxToolIterations} value={s.tool_policy?.max_iterations ?? 8} min={1} max={24} step={1}
            onCommit={(v) => p.onChange({ settings: { tool_policy: { max_iterations: v, tool_choice: s.tool_policy?.tool_choice ?? 'auto' } } })} />
          <label className="mt-1 block">
            <span className="mb-1 block">{l.toolChoice}</span>
            <select aria-label={l.toolChoice} value={s.tool_policy?.tool_choice ?? 'auto'}
              onChange={(e) => p.onChange({ settings: { tool_policy: { max_iterations: s.tool_policy?.max_iterations ?? 8, tool_choice: e.target.value as ToolPolicy['tool_choice'] } } })}
              className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-sm text-chat-fg">
              <option value="auto">{l.toolChoiceAuto}</option><option value="none">{l.toolChoiceNone}</option><option value="required">{l.toolChoiceRequired}</option>
            </select>
          </label>
          <p className="mt-1 text-[11px] text-chat-dim">{l.toolPolicyNote}</p>
        </fieldset>
      )}
      {p.selectionPrefs && p.onSelectionPrefsChange && <SelectionSection prefs={p.selectionPrefs} onChange={p.onSelectionPrefsChange} />}
      <div className="mt-auto">
        <Button variant="outline" size="sm" className="w-full" onClick={p.onSaveDefaults}>{l.saveDefaults}</Button>
        <p className="mt-1 text-[11px] text-chat-dim">{l.applyNote}</p>
      </div>
    </aside>
  );
}
