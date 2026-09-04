// spec §4.4: only after `done`, only on assistant messages without
// tool_call parts (the caller enforces that); text must END with a 2-6
// item list, items <= 6 words, the line immediately before the list must
// end with '?'.
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;
const TASK_ITEM = /^\s*[-*+]\s+\[[ xX]\]/;

export function detectTrailingOptions(text: string): { question: string; options: string[] } | null {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length < 3) return null;
  // collect the trailing list
  const items: string[] = [];
  let i = lines.length - 1;
  for (; i >= 0; i--) {
    const line = lines[i];
    if (TASK_ITEM.test(line)) return null;
    const m = ITEM.exec(line);
    if (!m) break;
    items.unshift(m[1]);
  }
  if (items.length < 2 || items.length > 6) return null;
  if (items.some((s) => s.length === 0 || s.split(/\s+/).length > 6)) return null;
  if (i < 0) return null;
  // the line immediately before the list (skipping ONE blank line) must end with '?'
  let q = lines[i];
  if (q.trim() === '' && i > 0) q = lines[i - 1];
  q = q.trim();
  if (!q.endsWith('?')) return null;
  return { question: q, options: items.map((s) => s.replace(/\s*--.*$/, '').trim()) };
}
