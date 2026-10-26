/**
 * Locale strings as hosts pass them — `ru-RU`, POSIX-style `ru_RU`, `''`, or
 * something `Intl` rejects — reduced to one canonical BCP 47 tag, so every
 * `Intl` call downstream either gets a valid tag or none at all.
 */

/** `ru_RU` → `ru-RU`, `es-mx` → `es-MX`; `undefined` for an empty or invalid tag. */
export function canonicalLocale(locale: string | null | undefined): string | undefined {
  if (typeof locale !== 'string') return undefined;
  const tag = locale.trim().replace(/_/g, '-');
  if (!tag) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** The language subtag of a locale (`ru_RU` → `ru`); `undefined` for an empty or invalid one. */
export function localeLanguage(locale: string | null | undefined): string | undefined {
  const tag = canonicalLocale(locale);
  if (!tag) return undefined;
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return undefined;
  }
}
