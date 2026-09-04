// Mirrors app/chat2/limits.py; keep in sync by hand (the values are
// asserted by tests/contract/chat2/limits.test.ts in Task 7).
export const MAX_IMAGE_BYTES = 10 * 1024 ** 2;
export const MAX_IMAGES_PER_MESSAGE = 8;
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const RESERVE_CAP_TOKENS = 4096;
export const SIGNED_URL_TTL_S = 600;
export const TITLE_MAX_CHARS = 60;
export const DATA_URL_MAX_BYTES = 2 * 1024 ** 2;
export const TOOL_BLOCK_CHAR_CAP = 10_000;
export const CODE_FOLD_PX = 400;
export const CONTEXT_AMBER = 0.85;
export const TICKET_REFRESH_MS = 8 * 60_000;
