'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AlertCircle, GitFork, Pencil, Plus, Trash2, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import type { Capabilities, ScopeOption } from '../adapters/capabilities';
import type { ChatSummary } from '../adapters/types';
import { DEFAULT_LABELS, type Labels } from '../app/labels';

export interface ChatSidebarProps {
  chats: ChatSummary[]; selectedId: string | null; collapsed: boolean; onToggle: () => void;
  onSelect: (id: string) => void; onNew: () => void; onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void; onDeleteAll: () => void; onFork: (id: string) => void;
  /**
   * Whether a new chat can be started at all. A chat with no loaded model can
   * never be sent to, so offering the button only to have the composer refuse
   * every message is a dead end the user has to back out of — required (not
   * optional-with-a-default) so a caller cannot forget to answer.
   */
  canCreate: boolean;
  /** Rendered as the disabled button's tooltip. */
  createDisabledReason?: string;
  /**
   * The host's product decisions. Two keys reach this component: `sharedChats`
   * (group other people's chats under their name and make them read-only) and
   * `scopeLabel` (a per-row badge). Required rather than defaulted so a caller
   * cannot silently get the single-user behaviour on a multi-user host.
   */
  capabilities: Capabilities;
  /**
   * Who is looking. Only consulted when `capabilities.sharedChats` is on:
   * without it there is nothing to compare `chat.owner.id` against, so the
   * list stays ungrouped and fully editable.
   */
  currentUserId?: string;
  /**
   * The host's scope choices, already loaded (`capabilities.scopes.list()` is
   * the owner's job, not this component's — it renders, it does not fetch).
   * The picker appears only with two or more of them AND a `scopes`
   * capability to name it: one option is a binding, not a choice, and a
   * control with nothing to change is noise above the button that matters.
   */
  scopeOptions?: readonly ScopeOption[];
  /** Which option the next new chat is bound to. */
  selectedScopeId?: string | null;
  onScopeChange?: (id: string) => void;
  /** Overrides for the three strings this component owns; English otherwise. */
  labels?: Partial<Pick<Labels, 'newChat' | 'filter' | 'deleteAll'>>;
  /** Forwarded to the confirm dialogs' `Modal` (which root goes `inert`). */
  rootInertId?: string;
}

function groupOf(iso: string, now: number): 'Today' | 'Yesterday' | 'Last 7 days' | 'Older' {
  const d = new Date(iso); const start = new Date(now); start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Last 7 days' : 'Older';
}
const GROUPS = ['Today', 'Yesterday', 'Last 7 days', 'Older'] as const;

export function ChatSidebar(p: ChatSidebarProps) {
  const labels = { ...DEFAULT_LABELS, ...p.labels };
  const [filter, setFilter] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [typed, setTyped] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelAllRef = useRef<HTMLButtonElement>(null);
  // Guards commitRename/cancelRename against re-entrancy: flushSync-ing
  // `renaming` to null synchronously removes the focused <input> from the
  // DOM, and that removal can synchronously fire a native blur on it (still
  // wired to this same onBlur handler) before this call has returned. Without
  // the guard that re-entrant blur reruns commitRename against the (now
  // stale) closed-over `renaming`, double-firing `onRename`.
  const closingRenameRef = useRef(false);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return p.chats.filter((c) => !f || c.title.toLowerCase().includes(f));
  }, [p.chats, filter]);
  // Shared-chat mode needs both halves of the question answered: the host has
  // to have turned the feature on AND said who is looking. With only one of
  // them the "is this mine?" test has no answer, and the safe answer is the
  // single-user one — every row is the viewer's own, exactly as before.
  const shared = !!(p.capabilities.sharedChats && p.currentUserId);
  const currentUserId = p.currentUserId;
  const isMine = useMemo(
    () => (c: ChatSummary) => !shared || !c.owner || c.owner.id === currentUserId,
    [shared, currentUserId],
  );

  // Date buckets for the viewer's own chats, then one bucket per colleague.
  // Both render through the same header/rows markup, so `flat` — and with it
  // the roving tabindex, `aria-activedescendant` and the arrow keys — covers
  // a colleague's rows as well; only the row's *actions* differ.
  const sections = useMemo(() => {
    const now = Date.now();
    const mine = new Map<string, ChatSummary[]>();
    const others = new Map<string, ChatSummary[]>();
    for (const c of visible) {
      if (isMine(c)) {
        // Same key the server sorts on (`COALESCE(last_message_at, created_at) DESC`)
        // — grouping by `updated_at` put a renamed old chat under Today while it
        // stayed at its original position in the list.
        const g = groupOf(c.last_message_at ?? c.created_at, now);
        mine.set(g, [...(mine.get(g) ?? []), c]);
      } else {
        const g = c.owner?.name ?? 'Shared';
        others.set(g, [...(others.get(g) ?? []), c]);
      }
    }
    return [
      // date groups keep their fixed order; owner groups follow in the order
      // the server's sort first mentions them
      ...GROUPS.filter((g) => mine.has(g)).map((g) => ({ key: `date:${g}`, label: g, rows: mine.get(g)! })),
      ...[...others].map(([name, rows]) => ({ key: `owner:${name}`, label: name, rows })),
    ];
  }, [visible, isMine]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  // "Delete all" is `DELETE /chats`, which the backend scopes to the caller —
  // a colleague's shared rows are neither counted nor deleted. Counting
  // `p.chats` instead promised to delete rows the call cannot touch, and left
  // the button enabled for a viewer who owns nothing in a list full of
  // someone else's chats. Deliberately counts `p.chats`, not `visible`: the
  // filter box narrows what is SHOWN, never what the button deletes.
  const mineCount = useMemo(() => p.chats.filter(isMine).length, [p.chats, isMine]);
  const focusOption = (i: number) => { const el = listRef.current?.querySelectorAll<HTMLElement>('[role=option]')[i]; el?.focus(); };
  useEffect(() => { if (focusIdx >= flat.length) setFocusIdx(Math.max(0, flat.length - 1)); }, [flat.length, focusIdx]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (renaming) return;
    const c = flat[focusIdx];
    if (!c && e.key !== 'ArrowDown') return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); { const n = Math.min(flat.length - 1, focusIdx + 1); setFocusIdx(n); focusOption(n); } break;
      case 'ArrowUp': e.preventDefault(); { const n = Math.max(0, focusIdx - 1); setFocusIdx(n); focusOption(n); } break;
      case 'Home': e.preventDefault(); setFocusIdx(0); focusOption(0); break;
      case 'End': e.preventDefault(); setFocusIdx(flat.length - 1); focusOption(flat.length - 1); break;
      case 'Enter': case ' ': e.preventDefault(); p.onSelect(c.id); break;
      // The keyboard paths mirror the buttons: a colleague's chat offers no
      // Rename/Delete icon, so F2 and Delete must not be a back door to the
      // same two mutations.
      case 'F2': e.preventDefault(); if (isMine(c)) setRenaming({ id: c.id, value: c.title }); break;
      case 'Delete': case 'Backspace': e.preventDefault(); if (isMine(c)) setConfirmDelete(c.id); break;
    }
  }
  function commitRename() {
    if (closingRenameRef.current || !renaming) return;
    closingRenameRef.current = true;
    const t = renaming.value.trim();
    if (t && t !== flat.find((c) => c.id === renaming.id)?.title) p.onRename(renaming.id, t);
    flushSync(() => setRenaming(null));
    focusOption(focusIdx);
    closingRenameRef.current = false;
  }
  function cancelRename() {
    if (closingRenameRef.current) return;
    closingRenameRef.current = true;
    flushSync(() => setRenaming(null));
    focusOption(focusIdx);
    closingRenameRef.current = false;
  }

  // The picker is deliberately absent from the collapsed rail below: the rail
  // is a column of icon buttons with no room for a labelled select. What the
  // rail DOES carry is the current choice, in the create button's tooltip —
  // otherwise collapsing the sidebar hides which scope the next chat lands in
  // while leaving the button that creates it.
  const scopes = p.capabilities.scopes;
  const scopeOptions = p.scopeOptions ?? [];
  const showScopes = !!scopes && scopeOptions.length >= 2;
  const selectedScopeLabel = showScopes ? scopeOptions.find((o) => o.id === p.selectedScopeId)?.label : undefined;
  // A real `for`/`id` pair, not `aria-label`: the caption is visible copy the
  // user can click to reach the control, and one accessible name — not a
  // wrapping label AND an aria-label saying the same thing twice.
  const scopeSelectId = useId();
  const scopePicker = showScopes && scopes ? (
    <div className="mx-2 mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider text-chat-dim">
      <label className="mb-1 block" htmlFor={scopeSelectId}>{scopes.label}</label>
      <select id={scopeSelectId} value={p.selectedScopeId ?? ''} onChange={(e) => p.onScopeChange?.(e.target.value)}
        className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 text-xs font-normal normal-case tracking-normal text-chat-fg focus:[outline:none] focus:ring-1 focus:ring-chat-accent">
        {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  ) : null;
  // The disabled reason wins: "why can't I click this" beats "what would this
  // have created" on a button that cannot be pressed.
  const newChatTitle = !p.canCreate
    ? p.createDisabledReason
    : scopes && selectedScopeLabel
      ? `${labels.newChat} · ${scopes.label}: ${selectedScopeLabel}`
      : undefined;

  if (p.collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-r border-chat-rule p-2">
        <Button variant="ghost" size="sm" aria-label="Expand chat list" onClick={p.onToggle}><PanelLeftOpen className="h-4 w-4" aria-hidden /></Button>
        <Button size="sm" aria-label={labels.newChat} title={newChatTitle} disabled={!p.canCreate} onClick={p.onNew}><Plus className="h-4 w-4" aria-hidden /></Button>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-chat-rule bg-chat-page/50" aria-label="Chats">
      {/* Above the create button, not beside it: it states what the NEXT new
          chat will be bound to, so it has to be read before that click. */}
      {scopePicker}
      <div className={`flex items-center gap-1 p-2${scopePicker ? ' pt-0' : ''}`}>
        <Button size="sm" className="flex-1" title={p.canCreate ? undefined : p.createDisabledReason} disabled={!p.canCreate} onClick={p.onNew}><Plus className="mr-1 h-4 w-4" aria-hidden /> {labels.newChat}</Button>
        <Button variant="ghost" size="sm" aria-label="Collapse chat list" onClick={p.onToggle}><PanelLeftClose className="h-4 w-4" aria-hidden /></Button>
      </div>
      <label className="relative mx-2 mb-1">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-chat-dim" aria-hidden />
        {/* The accessible name is the host's word too: a placeholder saying
            "Search conversations" beside an aria-label saying "Filter chats"
            reads as two different controls to a screen reader. */}
        <input type="search" role="searchbox" aria-label={labels.filter} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={labels.filter}
          className="w-full rounded-[0.25rem] border border-chat-rule bg-chat-page py-1 pl-7 pr-2 text-xs text-chat-fg focus:[outline:none] focus:ring-1 focus:ring-chat-accent" />
      </label>
      <ul ref={listRef} role="listbox" aria-label="Chat list" aria-activedescendant={flat[focusIdx] ? `chat-opt-${flat[focusIdx].id}` : undefined} onKeyDown={onKeyDown} className="flex-1 overflow-y-auto px-1">
        {sections.map((s) => (
          <li key={s.key} role="presentation">
            <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-chat-dim">{s.label}</div>
            <ul role="presentation">
              {s.rows.map((c) => {
                const i = flat.indexOf(c);
                const selected = c.id === p.selectedId;
                const mine = isMine(c);
                const scope = p.capabilities.scopeLabel?.(c.settings);
                return (
                  <li key={c.id} id={`chat-opt-${c.id}`} role="option" aria-selected={selected} tabIndex={i === focusIdx ? 0 : -1}
                    onFocus={() => setFocusIdx(i)} onClick={() => p.onSelect(c.id)} onDoubleClick={() => { if (mine) setRenaming({ id: c.id, value: c.title }); }}
                    className={`group flex cursor-pointer items-center gap-1 rounded-[0.25rem] px-2 py-1.5 text-sm [outline:none] focus-visible:ring-1 focus-visible:ring-chat-accent ${selected ? 'bg-chat-surface-2 text-chat-accent-strong' : 'text-chat-muted hover:bg-chat-surface-2'}`}>
                    {renaming?.id === c.id ? (
                      <input autoFocus aria-label="Rename chat" value={renaming.value} onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                        className="w-full rounded-[0.25rem] bg-chat-page px-1 text-sm text-chat-fg" />
                    ) : (
                      <>
                        {/* One clamping container (2 lines): the current title
                            renders first, wrapping onto a second line if needed;
                            the "(was: …)" hint is what gets clipped — a long
                            previous title can never squeeze the current one to
                            zero width (full text lives in title=). */}
                        <span className="line-clamp-2 min-w-0 flex-1 break-words" title={c.title_prev ? c.title + " (was: " + c.title_prev + ")" : c.title}>
                          {c.title}
                          {c.title_prev && (
                            <span className="text-[11px] text-chat-dim"> (was: {c.title_prev})</span>
                          )}
                        </span>
                        {/* Both badges sit OUTSIDE the clamping span: inside it,
                            a two-line title would push them past the clamp and
                            the row would silently lose them. They are also
                            suppressed while the row is being renamed, where the
                            full-width input owns the space. */}
                        {/* `surface` not `surface-2`: `surface-2` is the SELECTED row's own
                            background, so the chip vanished into the row exactly when
                            the row was selected. */}
                        {scope && <span className="rounded-[0.25rem] bg-chat-surface px-1 text-[10px] text-chat-muted">{scope}</span>}
                        {c.turn_status === 'running' && <span className="text-[11px] text-chat-muted"> · answering…</span>}
                      </>
                    )}
                    {c.context_full && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-chat-warn" aria-label="Context full" />}
                    {/* Fork is the rare action and stays hover/focus-revealed.
                        Rename and delete are not: hover-only hid them outright
                        on a touch screen, and from anyone who did not think to
                        hover. They sit at the `text-chat-dim` the rest of the
                        row's chrome uses and only colour up on hover.

                        All three are `tabIndex={-1}`. This is a `role=listbox`
                        with roving tabindex: one Tab lands on the list, arrows
                        move within it. Two permanently-visible tab stops per
                        row would turn a 40-chat sidebar into 80 Tab presses
                        between the list and whatever follows it. The keyboard
                        paths to these actions are the ones the listbox already
                        owns — F2 to rename, Delete/Backspace to delete — so
                        nothing is lost, and they keep their labels so a screen
                        reader user browsing the row still finds them.

                        On a colleague's chat only Fork survives: forking copies
                        the transcript into a chat of your own, which is the one
                        thing you may do to someone else's. Rename and delete
                        would be edits to their row, so the buttons are absent
                        rather than present-and-failing — and `onKeyDown` closes
                        the F2/Delete shortcuts to match. Which is also why Fork
                        stays PERMANENTLY visible there: it is that row's only
                        action, and hiding the only action behind hover leaves a
                        colleague's chat with no affordance at all on a touch
                        screen. On your own rows it is still the rare one of
                        three, so it stays hover/focus-revealed. */}
                    <button type="button" tabIndex={-1} aria-label={`Fork ${c.title}`} onClick={(e) => { e.stopPropagation(); p.onFork(c.id); }}
                      className={`shrink-0 rounded-[0.25rem] p-0.5 text-chat-dim hover:text-chat-accent ${mine ? 'hidden group-hover:block group-focus-within:block' : ''}`}><GitFork className="h-3.5 w-3.5" aria-hidden /></button>
                    {mine && <>
                      <button type="button" tabIndex={-1} aria-label={`Rename ${c.title}`} onClick={(e) => { e.stopPropagation(); setRenaming({ id: c.id, value: c.title }); }}
                        className="shrink-0 rounded-[0.25rem] p-0.5 text-chat-dim hover:text-chat-accent"><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
                      <button type="button" tabIndex={-1} aria-label={`Delete ${c.title}`} onClick={(e) => { e.stopPropagation(); setConfirmDelete(c.id); }}
                        className="shrink-0 rounded-[0.25rem] p-0.5 text-chat-dim hover:text-chat-negative"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {flat.length === 0 && <li className="px-2 py-4 text-xs text-chat-dim">No chats{filter ? ' match' : ' yet'}.</li>}
      </ul>
      <div className="border-t border-chat-rule p-2">
        <Button variant="ghost" size="sm" className="w-full text-chat-negative hover:opacity-90" onClick={() => { setTyped(''); setConfirmAll(true); }} disabled={mineCount === 0}>{labels.deleteAll}</Button>
      </div>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete chat?" initialFocusRef={cancelRef} rootInertId={p.rootInertId}>
        <p className="text-sm text-chat-muted">This deletes the chat and its images. This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => {
            const id = confirmDelete;
            if (!id) return;
            // Focus should land on the row that shifts into the deleted
            // row's place (i.e. the one that followed it) — or, if the
            // last row was deleted, on the new last row. `flat` here still
            // reflects the PRE-deletion list, so `delIdx` is the deleted
            // row's own index (not necessarily `focusIdx`: the trash icon
            // can delete a row that isn't the currently focused one) and
            // `flat.length - 1` is the post-deletion count.
            const delIdx = flat.findIndex((c) => c.id === id);
            const n = delIdx === -1 ? Math.max(0, focusIdx - 1) : Math.max(0, Math.min(delIdx, flat.length - 2));
            p.onDelete(id);
            flushSync(() => { setConfirmDelete(null); setFocusIdx(n); });
            focusOption(n);
          }}>Delete</Button>
        </div>
      </Modal>
      <Modal open={confirmAll} onClose={() => setConfirmAll(false)} title="Delete all chats?" initialFocusRef={cancelAllRef} rootInertId={p.rootInertId}>
        <p className="text-sm text-chat-muted">All {mineCount} of your chats and their images will be deleted. Type <strong>DELETE</strong> to confirm.</p>
        <input aria-label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-3 w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-sm text-chat-fg" />
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelAllRef} variant="outline" onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button variant="destructive" disabled={typed !== 'DELETE'} onClick={() => { p.onDeleteAll(); setConfirmAll(false); }}>Delete everything</Button>
        </div>
      </Modal>
    </aside>
  );
}
