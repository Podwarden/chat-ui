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
