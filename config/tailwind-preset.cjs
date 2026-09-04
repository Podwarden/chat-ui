/**
 * Tailwind v3 preset for @podwarden/chat-ui.
 *
 * Adds the semantic `chat-*` colour scale, every entry resolving through the
 * `--chat-*` CSS variables defined by `@podwarden/chat-ui/theme.css`. The
 * `<alpha-value>` placeholder is what lets `bg-chat-surface/50` work.
 *
 * `ring-offset-*` reads `theme.ringOffsetColor`, which defaults to
 * `theme.colors`, so `ring-offset-chat-surface` resolves from these entries
 * with no extra configuration.
 *
 * Usage (host tailwind.config.js):
 *   presets: [require('@podwarden/chat-ui/tailwind-preset')],
 *   content: ['./node_modules/@podwarden/chat-ui/dist/**\/*.js', ...],
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        chat: {
          page: 'rgb(var(--chat-page) / <alpha-value>)',
          surface: 'rgb(var(--chat-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--chat-surface-2) / <alpha-value>)',
          rule: 'rgb(var(--chat-rule) / <alpha-value>)',
          fg: 'rgb(var(--chat-fg) / <alpha-value>)',
          'on-accent': 'rgb(var(--chat-on-accent) / <alpha-value>)',
          muted: 'rgb(var(--chat-muted) / <alpha-value>)',
          dim: 'rgb(var(--chat-dim) / <alpha-value>)',
          accent: 'rgb(var(--chat-accent) / <alpha-value>)',
          'accent-strong': 'rgb(var(--chat-accent-strong) / <alpha-value>)',
          user: 'rgb(var(--chat-user) / <alpha-value>)',
          warn: 'rgb(var(--chat-warn) / <alpha-value>)',
          'warn-dim': 'rgb(var(--chat-warn-dim) / <alpha-value>)',
          negative: 'rgb(var(--chat-negative) / <alpha-value>)',
          'negative-dim': 'rgb(var(--chat-negative-dim) / <alpha-value>)',
          positive: 'rgb(var(--chat-positive) / <alpha-value>)',
          code: 'rgb(var(--chat-code) / <alpha-value>)',
        },
      },
    },
  },
};
