/**
 * Tailwind v3 config for this example. See the package README's
 * "Tailwind 3.4 hosts" section — this is that snippet, applied.
 */
module.exports = {
  presets: [require('@podwarden/chat-ui/tailwind-preset')],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@podwarden/chat-ui/dist/**/*.js',
  ],
};
