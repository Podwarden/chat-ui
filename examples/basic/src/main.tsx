import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp, ChatWidget, type ChatTheme } from '@podwarden/chat-ui';
import '@podwarden/chat-ui/theme.css';
import './index.css';
import { createDemoAdapters } from './demo-adapters';
import { DEMO_CHAT_ID, SEED_IDS } from './fixtures';
import { LABELS_DE } from './labels-de';

// Module-level, not built inside a component: `<ChatApp>` remounts its whole
// thread whenever the `adapters` object's identity changes (see the package
// README's "keep the adapters object stable" note), and the same is true of
// `capabilities` (a fresh object per render would re-run `listSkills()`).
const adapters = createDemoAdapters();
const capabilities = { toolPolicy: 'hidden' } as const;

// This example owns its own (very small) routing: two query parameters read
// once at startup, so a driver — a screenshot job, a link shared with a
// reviewer — can pin the app into a deterministic state without touching any
// code.
//   ?theme=light|dark  which look to render; anything else (including no
//                      param at all) falls back to dark.
//   ?seed=<key>        open one of the seeded chats instead of whichever
//                      chat would otherwise sort first. `key` is looked up
//                      in `SEED_IDS` (fixtures.ts) — `demo` (the original
//                      value, still the fenced-code-and-LaTeX chat),
//                      `tools`, `options`, `attachments`, `fork`. Any other
//                      (or empty-string) value falls back to `demo`, so
//                      `?seed` alone keeps working exactly as before.
//   ?view=widget       a stand-in host page with <ChatWidget> open in its
//                      corner, instead of the full-page <ChatApp>.
//   ?locale=de         the German catalog in ./labels-de.ts and German
//                      number/date formatting.
//   ?select=<text>     once the transcript has rendered, select the first
//                      occurrence of <text> in it, so the selection menu
//                      opens without a mouse (a screenshot driver has none).
const params = new URLSearchParams(window.location.search);
const theme: ChatTheme = params.get('theme') === 'light' ? 'light' : 'dark';
const seed = params.get('seed');
const initialChatId = seed ? (SEED_IDS[seed] ?? DEMO_CHAT_ID) : null;
const view = params.get('view') === 'widget' ? 'widget' : 'app';
const german = params.get('locale') === 'de';
const labels = german ? LABELS_DE : undefined;
const locale = german ? 'de' : undefined;
const selectText = params.get('select');

/** Selects the first `text` inside a rendered message, retrying until the transcript has it. */
function selectWhenRendered(text: string, triesLeft = 100) {
  const root = document.querySelector('[data-selection-root]');
  const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_TEXT) : null;
  for (let n = walker?.nextNode(); n; n = walker!.nextNode()) {
    const i = n.textContent?.indexOf(text) ?? -1;
    if (i < 0) continue;
    const range = document.createRange();
    range.setStart(n, i);
    range.setEnd(n, i + text.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return;
  }
  if (triesLeft > 0) setTimeout(() => selectWhenRendered(text, triesLeft - 1), 100);
}
if (selectText) selectWhenRendered(selectText);

/** The page a widget host would have anyway — here only so the widget has something to sit on. */
function HostPage() {
  return (
    <div className="min-h-full bg-chat-surface">
      <header className="flex items-center gap-6 border-b border-chat-rule bg-chat-page px-8 py-4">
        <span className="font-semibold">{german ? 'Ihr Produkt' : 'Your product'}</span>
        <nav className="flex gap-4 text-sm text-chat-muted">
          <span>{german ? 'Übersicht' : 'Overview'}</span><span>{german ? 'Projekte' : 'Projects'}</span><span>{german ? 'Abrechnung' : 'Billing'}</span>
        </nav>
      </header>
      <main className="grid max-w-3xl grid-cols-2 gap-4 p-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-lg border border-chat-rule bg-chat-page p-4">
            <div className="h-3 w-24 rounded bg-chat-surface-2" />
            <div className="mt-3 h-2 w-40 rounded bg-chat-surface-2" />
            <div className="mt-2 h-2 w-32 rounded bg-chat-surface-2" />
          </div>
        ))}
      </main>
    </div>
  );
}

// Flips the light/dark token overrides in ./index.css. `theme` (the prop
// below) separately drives Shiki's own light/dark syntax theme — see
// src/components/code-block.tsx — the two are deliberately kept in sync here
// even though the package itself never links them.
document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'widget' ? (
      <>
        <HostPage />
        <ChatWidget
          adapters={adapters}
          capabilities={capabilities}
          theme={theme}
          initialChatId={initialChatId}
          labels={labels}
          locale={locale}
          defaultOpen
          fullPageHref="?"
          // both off by default in the package; on here so the demo shows them
          resizable
          movable
        />
      </>
    ) : (
      <ChatApp
        adapters={adapters}
        capabilities={capabilities}
        theme={theme}
        initialChatId={initialChatId}
        syncUrlParam={null}
        labels={labels}
        locale={locale}
        // the chat IS this page: header and composer stay on screen on a
        // phone, through the browser toolbar and the keyboard
        fitViewport
      />
    )}
  </StrictMode>,
);
