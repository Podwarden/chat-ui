import { ApiError } from './types';

/**
 * Parse a chat2 error response into an `ApiError`.
 *
 * The backend's single error envelope (app/chat2/errors.py) is
 * `{"detail": {"code": "...", "message": "..."}}` for every chat2 route.
 * Two exceptions still have to be handled here:
 *   - the identity dependency's 401 (app/chat2/identity.py) raises with a
 *     bare string `detail` ("unknown subject") — no `code`;
 *   - FastAPI's own request-validation 422s emit `detail` as a *list* of
 *     `{loc, msg, type}` objects (there is no chat2-specific handling for
 *     these — they come straight from pydantic) — mapped here to a
 *     synthetic `code: 'invalid'` and the first item's `msg`.
 */
export async function readError(r: Response): Promise<ApiError> {
  let code = 'internal';
  let message = `HTTP ${r.status}`;
  try {
    const body = (await r.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') {
      message = body.detail;
    } else if (Array.isArray(body.detail)) {
      code = 'invalid';
      const first = body.detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first.msg === 'string') message = first.msg;
    } else if (body.detail && typeof body.detail === 'object') {
      const d = body.detail as { code?: unknown; message?: unknown };
      if (typeof d.code === 'string') code = d.code;
      if (typeof d.message === 'string') message = d.message;
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(r.status, code, message);
}

export async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw await readError(r);
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}
