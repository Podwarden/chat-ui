'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import type { Part } from '../model/message';

type OptionsPart = Extract<Part, { type: 'options' }>;

export function OptionsButtons({
  part,
  disabled,
  onPick,
}: {
  part: OptionsPart;
  disabled: boolean;
  onPick: (selected: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const answered = part.answered;
  const isDisabled = disabled || answered !== undefined;
  return (
    <div className="my-2" role="group" aria-label={part.question ?? 'Options'}>
      {part.question && <div className="mb-1 text-xs text-chat-muted">{part.question}</div>}
      <div className="flex flex-wrap gap-2">
        {part.options.map((o) => {
          const on = answered ? answered.includes(o.value) : picked.includes(o.value);
          return (
            <Button
              key={o.value}
              size="sm"
              variant={on ? 'default' : 'outline'}
              aria-pressed={on}
              disabled={isDisabled}
              onClick={() => {
                if (!part.multi) onPick([o.value]);
                else setPicked((p) => (p.includes(o.value) ? p.filter((v) => v !== o.value) : [...p, o.value]));
              }}
            >
              {o.label}
            </Button>
          );
        })}
        {part.multi && !answered && (
          <Button size="sm" disabled={isDisabled || picked.length === 0} onClick={() => onPick(picked)}>
            Confirm
          </Button>
        )}
      </div>
    </div>
  );
}
