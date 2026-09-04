export interface ClientTool { name: string; description: string; schema: Record<string, unknown>; validate: (args: unknown) => boolean }

function isOptionList(x: unknown): x is { label: string; value: string }[] {
  return Array.isArray(x) && x.length >= 2 && x.length <= 8
    && x.every((o) => typeof o === 'object' && o !== null && typeof (o as { label?: unknown }).label === 'string'
      && typeof (o as { value?: unknown }).value === 'string');
}

export const PRESENT_OPTIONS: ClientTool = {
  name: 'present_options',
  description: 'Offer the user a small set of choices as buttons.',
  schema: { type: 'object', properties: { question: { type: 'string' }, multi: { type: 'boolean' },
    options: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } } },
    required: ['options'] },
  validate: (args) => typeof args === 'object' && args !== null && isOptionList((args as { options?: unknown }).options)
    && ((args as { question?: unknown }).question === undefined || typeof (args as { question?: unknown }).question === 'string')
    && ((args as { multi?: unknown }).multi === undefined || typeof (args as { multi?: unknown }).multi === 'boolean'),
};

export const CLIENT_TOOLS: Record<string, ClientTool> = { present_options: PRESENT_OPTIONS };
export function validateArgs(name: string, args: unknown): boolean { return CLIENT_TOOLS[name]?.validate(args) ?? false; }
