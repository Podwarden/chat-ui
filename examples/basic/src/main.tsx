import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp, type ChatTheme } from '@podwarden/chat-ui';
import '@podwarden/chat-ui/theme.css';
import './index.css';
import { createDemoAdapters } from './demo-adapters';
import { DEMO_CHAT_ID } from './fixtures';

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
//   ?seed=<anything>   open the seeded chat that has a fenced code block and
//                      a LaTeX expression (DEMO_CHAT_ID) instead of
//                      whichever chat would otherwise sort first.
const params = new URLSearchParams(window.location.search);
const theme: ChatTheme = params.get('theme') === 'light' ? 'light' : 'dark';
const initialChatId = params.get('seed') ? DEMO_CHAT_ID : null;

// Flips the light/dark token overrides in ./index.css. `theme` (the prop
// below) separately drives Shiki's own light/dark syntax theme — see
// src/components/code-block.tsx — the two are deliberately kept in sync here
// even though the package itself never links them.
document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp
      adapters={adapters}
      capabilities={capabilities}
      theme={theme}
      initialChatId={initialChatId}
      syncUrlParam={null}
      className="h-screen"
    />
  </StrictMode>,
);
