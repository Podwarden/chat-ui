// Per-browser chat2 view preferences.
//
// These are NOT chat settings: they never reach the backend, they are not
// snapshotted onto a message, and they are the same for every chat. They
// belong to the person sitting in front of this browser.
//
// Every access is wrapped: `localStorage` throws outright in a few real
// environments (Safari private mode, a browser configured to block site
// data) and Node 24 ships a global `localStorage` whose every method throws
// unless the process was started with a backing file. A preference is never
// important enough to take the page down with it — a failed read is simply
// "no preference stated".

export const REASONING_OPEN_KEY = 'chat2:reasoningOpen';

/**
 * Whether reasoning blocks should open by themselves while they stream.
 *
 * Defaults to `true`: the streaming preamble is the interesting part of a
 * reasoning model's answer, and someone who does not want to watch it says
 * so exactly once by collapsing a block.
 */
export function readReasoningOpen(): boolean {
  try {
    // Anything other than an explicit "false" (including an absent key and a
    // value written by an older build) reads as the default.
    return localStorage.getItem(REASONING_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeReasoningOpen(open: boolean): void {
  try {
    localStorage.setItem(REASONING_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    // A preference that cannot be persisted still applies for this session.
  }
}

export const SELECTION_PREFS_KEY = 'chat2:selectionActions';

/**
 * The user's selection-actions preferences (Settings → "Text selection").
 *
 * Per browser like `reasoningOpen`: how a menu behaves under the user's mouse
 * is the person's choice, not the chat's, so it is never sent to the backend.
 */
export interface SelectionPrefs {
  /** "Show menu when selecting text" — the floating menu, the touch dock and the shortcut. */
  enabled: boolean;
  /** How long a finished selection must stay put before the menu appears (ms). */
  delayMs: number;
  /** "Explain" sends a message at once, or only puts it in the message box. */
  explainMode: 'send' | 'prefill';
  /** Quote stages a removable chip above the message box instead of inserting raw text. */
  quoteAsChips: boolean;
}

export const DEFAULT_SELECTION_PREFS: SelectionPrefs = {
  enabled: true,
  delayMs: 300,
  explainMode: 'send',
  quoteAsChips: true,
};

/** The bounds the settings UI and the reader both enforce on `delayMs`. */
export const SELECTION_DELAY_MIN_MS = 0;
export const SELECTION_DELAY_MAX_MS = 3000;

/**
 * Only the keys the user has actually set — so a host's own defaults (the
 * `selectionActions` prop) still apply to everything they have not touched.
 * Malformed or out-of-range values are dropped, never thrown.
 */
export function readSelectionPrefs(): Partial<SelectionPrefs> {
  try {
    const raw = localStorage.getItem(SELECTION_PREFS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<SelectionPrefs> = {};
    if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
    if (typeof v.delayMs === 'number' && Number.isFinite(v.delayMs) && v.delayMs >= SELECTION_DELAY_MIN_MS && v.delayMs <= SELECTION_DELAY_MAX_MS) out.delayMs = v.delayMs;
    if (v.explainMode === 'send' || v.explainMode === 'prefill') out.explainMode = v.explainMode;
    if (typeof v.quoteAsChips === 'boolean') out.quoteAsChips = v.quoteAsChips;
    return out;
  } catch {
    return {};
  }
}

/** Merges `patch` into what is stored (the keys the user has set so far). */
export function writeSelectionPrefs(patch: Partial<SelectionPrefs>): void {
  try {
    localStorage.setItem(SELECTION_PREFS_KEY, JSON.stringify({ ...readSelectionPrefs(), ...patch }));
  } catch {
    // applies for this session only
  }
}

export const TEXT_SCALE_KEY = 'chat2:textScale';

/** The bounds and step of the transcript's text scale (1 = the package's own sizes). */
export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 2;
export const TEXT_SCALE_STEP = 0.1;

/** `n` inside the bounds and on a 1% grid, so a pinch never stores 1.3172. */
export function clampTextScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n)) * 100) / 100;
}

/**
 * The transcript's text scale (pinch in the transcript, Settings → Text size).
 * Per browser: it is about the reader's eyes and screen, not the chat.
 * `null` when the user has never set one, so the host's default applies.
 */
export function readTextScale(): number | null {
  try {
    const raw = localStorage.getItem(TEXT_SCALE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? clampTextScale(n) : null;
  } catch {
    return null;
  }
}

export function writeTextScale(scale: number): void {
  try {
    localStorage.setItem(TEXT_SCALE_KEY, String(clampTextScale(scale)));
  } catch {
    // applies for this session only
  }
}
