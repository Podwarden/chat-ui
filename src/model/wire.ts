// SSE framing rules (normalise \r, split on
// \n\n, collect data: lines)
import { type ChatEvent, isChatEvent } from './events';

function dataPayload(event: string): string | null {
  const lines = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
  return lines.length ? lines.join('\n') : null;
}

export async function* parseSseStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { return; }
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) {
        const payload = dataPayload(p);
        if (payload === null || payload === '[DONE]') continue;
        let obj: unknown;
        try { obj = JSON.parse(payload); } catch { continue; }
        if (isChatEvent(obj)) yield obj;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
