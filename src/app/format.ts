/**
 * Number and date formatting for the `locale` prop.
 *
 * Without a locale every value renders exactly as 0.1.25 rendered it — some
 * through `toLocaleString()` (the runtime's own locale), some raw — so a host
 * that never passes one sees no change. With a locale, everything goes
 * through `Intl` in that locale.
 */

import { canonicalLocale } from '../model/locale';

export interface Formatters {
  /** Counts 0.1.25 printed raw (token counts, message numbers, durations). */
  count(n: number): string;
  /** Numbers 0.1.25 printed with `toLocaleString()` (context sizes, characters). */
  number(n: number): string;
  /** A number with exactly `digits` decimals (`toFixed` without a locale). */
  fixed(n: number, digits: number): string;
  /** A date and time (`toLocaleString()` without a locale). */
  dateTime(value: string | number | Date): string;
  /** US dollars with exactly `digits` decimals (`$1.2345` without a locale). */
  usd(amount: number, digits: number): string;
  /** A fraction as a whole percentage (`150%` without a locale). */
  percent(fraction: number): string;
}

/**
 * Formatting for `locale`; `undefined` keeps the 0.1.25 output, and so does an
 * empty or invalid tag (`ru_RU` is read as `ru-RU`).
 */
export function createFormatters(locale: string | undefined): Formatters {
  locale = canonicalLocale(locale);
  if (!locale) {
    return {
      count: (n) => String(n),
      number: (n) => n.toLocaleString(),
      fixed: (n, digits) => n.toFixed(digits),
      dateTime: (v) => new Date(v).toLocaleString(),
      usd: (amount, digits) => `$${amount.toFixed(digits)}`,
      percent: (f) => `${Math.round(f * 100)}%`,
    };
  }
  const tag = locale;
  // Built once per kind and digit count: these run for every message footer
  // and on every lightbox zoom step.
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, opts?: Intl.NumberFormatOptions) => {
    let f = cache.get(key);
    if (!f) {
      try { f = new Intl.NumberFormat(tag, opts); } catch { f = new Intl.NumberFormat('en', opts); }
      cache.set(key, f);
    }
    return f;
  };
  const plain = nf('plain');
  return {
    count: (n) => plain.format(n),
    number: (n) => plain.format(n),
    fixed: (n, digits) => nf(`fixed:${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n),
    dateTime: (v) => {
      try { return new Date(v).toLocaleString(tag); } catch { return new Date(v).toLocaleString('en'); }
    },
    usd: (amount, digits) => nf(`usd:${digits}`, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount),
    percent: (f) => nf('percent', { style: 'percent', maximumFractionDigits: 0 }).format(f),
  };
}

/** One string per CLDR plural category; `other` is required, the rest fall back to it. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/**
 * The form of `forms` that `n` takes in `locale` (CLDR rules via
 * `Intl.PluralRules`, English without a locale). For hosts with no i18n
 * library of their own:
 *
 * ```ts
 * deleteAllBody: (n, f) => selectPlural('ru', n, {
 *   one: `Будет удалён ${f} чат`, few: `Будут удалены ${f} чата`,
 *   many: `Будут удалены ${f} чатов`, other: `Будут удалены ${f} чата`,
 * })
 * ```
 */
export function selectPlural(locale: string | undefined, n: number, forms: PluralForms): string {
  let category: Intl.LDMLPluralRule = 'other';
  try {
    category = new Intl.PluralRules(canonicalLocale(locale) ?? 'en').select(n);
  } catch {
    category = new Intl.PluralRules('en').select(n);
  }
  return forms[category] ?? forms.other;
}
