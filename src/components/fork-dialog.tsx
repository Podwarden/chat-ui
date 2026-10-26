'use client';
import { useRef, useState } from 'react';
import { Modal } from '@/ui/modal';
import { Button } from '@/ui/button';
import { useChatLabels } from '../app/labels-context';

export interface ForkDialogProps {
  open: boolean; mode: 'fork' | 'edit'; atSeq: number; initialText?: string;
  onClose: () => void; onConfirm: (editedText?: string) => void;
  /** Forwarded to `Modal` (which root goes `inert` while it is open). */
  rootInertId?: string;
}

export function ForkDialog({ open, mode, atSeq, initialText, onClose, onConfirm, rootInertId }: ForkDialogProps) {
  const { labels, format } = useChatLabels();
  const l = labels.forkDialog;
  const [text, setText] = useState(initialText ?? '');
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <Modal open={open} onClose={onClose} title={mode === 'edit' ? l.editTitle : l.forkTitle} initialFocusRef={ref} rootInertId={rootInertId}>
      <p className="text-sm text-chat-muted">
        {mode === 'edit'
          ? l.editBody(atSeq - 1, format.count(atSeq - 1))
          : l.forkBody(atSeq, format.count(atSeq))}
      </p>
      {mode === 'edit' && (
        <textarea aria-label={l.editedMessage} value={text} onChange={(e) => setText(e.target.value)} rows={6}
          className="mt-3 w-full rounded-[0.25rem] border border-chat-rule bg-chat-page px-2 py-1 font-mono text-sm text-chat-fg" />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{labels.common.cancel}</Button>
        <Button ref={ref} onClick={() => onConfirm(mode === 'edit' ? text : undefined)} disabled={mode === 'edit' && !text.trim()}>
          {mode === 'edit' ? l.forkWithEdit : l.fork}
        </Button>
      </div>
    </Modal>
  );
}
