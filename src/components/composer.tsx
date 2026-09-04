'use client';

import { Paperclip, Send, Square } from 'lucide-react';
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { ALLOWED_IMAGE_MIMES } from '../model/limits';
import type { Capabilities } from '../adapters/capabilities';
import type { Draft } from '../hooks/use-attachments';
import { AttachmentTray } from './attachment-tray';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  isStreaming: boolean;
  /** Page-level block (turn in flight in another tab, context full, budget, model not loaded, …). */
  disabled: boolean;
  /** Why it is blocked — always rendered when set, so a disabled Send is never mute. */
  disabledReason?: string;
  drafts: Draft[];
  /**
   * Whether images may be attached at all. Separate from `disabled`: a
   * text-only model can still take messages, it just cannot take pictures —
   * the backend replaces them with "[image omitted]", so the affordance
   * should not be offered in the first place.
   */
  canAttach: boolean;
  /** Rendered as the disabled attach button's tooltip. */
  attachDisabledReason?: string;
  onAddFiles: (files: File[]) => void;
  onRemoveDraft: (localId: string) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /**
   * What the host lets this chat do. Nothing in the composer reads it yet —
   * it is here so `<ChatApp>` can hand the merged capabilities to both panels
   * that will need them (the scope badge lands in Task 9) without another
   * prop-shape change.
   */
  capabilities?: Capabilities;
  /**
   * Identity of the surface being typed into (the selected chat id). On mount
   * and whenever it changes the textarea takes focus — unless the cursor is
   * already in another editable field, which is never stolen from.
   */
  focusKey?: string | null;
}

const MAX_ROWS_PX = 8 * 24;

/** Focus sits in an editable field that is not `ta` — a place never to steal from. */
function focusIsElsewhereEditable(ta: HTMLTextAreaElement): boolean {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === ta) return false;
  return (
    a.isContentEditable ||
    a instanceof HTMLInputElement ||
    a instanceof HTMLTextAreaElement ||
    a instanceof HTMLSelectElement
  );
}

export function Composer(p: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // auto-grow: reset to 0 first so the textarea can also shrink back down
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_ROWS_PX)}px`;
  }, [p.value]);

  const taDisabled = p.disabled && !p.isStreaming;

  // Take focus on mount, on chat switch and when the field re-enables — the
  // message box is where typing belongs, and nothing else ever hands focus
  // back. Never steals from another editable field the user is typing in.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || ta.disabled || focusIsElsewhereEditable(ta)) return;
    ta.focus();
  }, [p.focusKey, taDisabled]);

  // "Type anywhere" (user feedback): a click or scroll in the thread drops
  // focus onto the scroller or <body>, after which keystrokes went nowhere.
  // A printable key or Backspace pressed on a non-editable target belongs to
  // the message box: focus it and let the key's default action land there.
  // Editable fields and open dialogs keep their own keys; nothing with
  // Ctrl/Cmd/Alt (shortcuts) is ever touched.
  useEffect(() => {
    const onDocKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== 'Backspace') return;
      const ta = taRef.current;
      if (!ta || ta.disabled || document.activeElement === ta) return;
      if (focusIsElsewhereEditable(ta)) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      ta.focus();
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, []);

  const busy = p.drafts.some((d) => d.status === 'uploading');
  const missing = p.drafts.some((d) => d.status === 'missing');
  const failed = p.drafts.some((d) => d.status === 'error');
  const hasReadyImage = p.drafts.some((d) => d.status === 'ready');
  const canSend =
    !p.disabled && !p.isStreaming && !busy && !missing && !failed && (p.value.trim().length > 0 || hasReadyImage);

  // one reason line, most specific first: the page's own block outranks a
  // draft problem the user can fix by removing a chip
  const reason =
    p.disabledReason ??
    (missing
      ? (p.drafts.find((d) => d.status === 'missing')?.error ?? 'An image expired — remove it and attach again')
      : failed
        ? 'Remove the failed image to send'
        : busy
          ? 'Uploading images…'
          : undefined);

  function send() {
    if (canSend) p.onSend();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      if (!p.isStreaming) return;
      e.preventDefault();
      p.onAbort();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    // IME composition: the Enter that commits a candidate must never send.
    // React's synthetic keyboard event does not carry `isComposing`, so read
    // the native one; the second check covers test/synthetic events that put
    // the flag on the React event instead.
    if (e.nativeEvent.isComposing || (e as unknown as { isComposing?: boolean }).isComposing) return;
    e.preventDefault();
    send();
  }

  return (
    <div className="rounded-[0.25rem] border border-chat-rule bg-chat-surface/50">
      <AttachmentTray drafts={p.drafts} onRemove={p.onRemoveDraft} />
      {reason && (
        <div data-testid="composer-reason" role="status" className="px-3 pt-2 text-xs text-chat-warn">
          {reason}
        </div>
      )}
      <div className="flex items-end gap-2 p-2">
        <input
          ref={fileRef}
          data-testid="file-input"
          type="file"
          multiple
          accept={ALLOWED_IMAGE_MIMES.join(',')}
          className="hidden"
          onChange={(e) => {
            p.onAddFiles(Array.from(e.target.files ?? []));
            // reset so re-picking the same file fires `change` again
            e.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Attach image"
          title={p.canAttach ? undefined : p.attachDisabledReason}
          onClick={() => fileRef.current?.click()}
          disabled={p.disabled || p.isStreaming || !p.canAttach}
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </Button>
        <textarea
          ref={taRef}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={p.onPaste}
          rows={1}
          // stays enabled while streaming so Esc can stop the turn
          disabled={taDisabled}
          placeholder={
            p.disabled
              ? (p.disabledReason ?? 'Unavailable')
              : 'Message… (Enter to send, Shift+Enter for newline, drop or paste images)'
          }
          aria-label="Message"
          className="max-h-48 min-h-[2.25rem] flex-1 resize-none rounded-[0.25rem] bg-chat-page px-3 py-2 font-mono text-sm text-chat-fg placeholder:text-chat-dim focus:[outline:none] focus:ring-2 focus:ring-chat-accent"
        />
        {p.isStreaming ? (
          <Button variant="destructive" size="md" aria-label="Stop" onClick={p.onAbort}>
            <Square className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button size="md" aria-label="Send" onClick={send} disabled={!canSend}>
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
