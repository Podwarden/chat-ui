/**
 * LaTeX-style math delimiters → remark-math's $-forms.
 *
 * LLMs write display math as `\[ … \]` and inline math as `\( … \)`. remark-math
 * parses only `$ … $` / `$$ … $$`, and CommonMark unescapes `\[` to a literal
 * bracket — so the formula reached the screen as plain text ("[ x_i = \frac… ]").
 * This runs on the RAW markdown, before parsing, and rewrites balanced LaTeX
 * delimiters to the $-forms:
 *
 *  - `\[ … \]` standalone on its own line(s) → a `$$` display block;
 *    mid-sentence it becomes `$$…$$` inline so the paragraph is not restructured.
 *  - `\( … \)` → `$…$`.
 *  - Fenced blocks and inline code are never touched (a TeX sample in a fence
 *    stays source). Indented (4-space) code blocks are not tracked — LLM output
 *    fences its code.
 *  - Only balanced pairs convert, so a half-arrived `\[` during streaming stays
 *    literal until its `\]` lands in a later frame.
 *  - An unescaped `$` inside a converted body is escaped (`\$`), so a stray
 *    dollar cannot terminate the math early.
 */

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /(`+)[\s\S]*?\1/g;

function escapeDollars(body: string): string {
  return body.replace(/(?<!\\)\$/g, '\\$');
}

function convertPlain(text: string): string {
  const out = text.replace(/\\\[([\s\S]*?)\\\]/g, (whole, body: string, offset: number, s: string) => {
    const tex = escapeDollars(body).trim();
    const atLineStart = /(^|\n)[ \t]*$/.test(s.slice(0, offset));
    const atLineEnd = /^[ \t]*(\n|$)/.test(s.slice(offset + whole.length));
    return atLineStart && atLineEnd ? `$$\n${tex}\n$$` : `$$${tex}$$`;
  });
  return out.replace(/\\\(([\s\S]*?)\\\)/g, (_whole, body: string) => `$${escapeDollars(body).trim()}$`);
}

function convertOutsideInlineCode(segment: string): string {
  let result = '';
  let last = 0;
  for (const m of segment.matchAll(INLINE_CODE_RE)) {
    result += convertPlain(segment.slice(last, m.index));
    result += m[0];
    last = m.index + m[0].length;
  }
  return result + convertPlain(segment.slice(last));
}

/** Rewrite `\[ … \]` / `\( … \)` to `$$ … $$` / `$ … $`, skipping code. */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes('\\[') && !text.includes('\\(')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let fence: { char: string; len: number } | null = null;
  const flush = () => {
    if (buf.length) {
      out.push(convertOutsideInlineCode(buf.join('\n')));
      buf = [];
    }
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
    } else {
      const m = line.match(FENCE_OPEN_RE);
      if (m) {
        flush();
        out.push(line);
        fence = { char: m[1][0], len: m[1].length };
      } else {
        buf.push(line);
      }
    }
  }
  flush();
  return out.join('\n');
}
