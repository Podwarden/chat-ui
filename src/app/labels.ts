/**
 * The handful of visible strings a host is expected to want to own — its
 * product vocabulary ("chat" vs "conversation" vs "session") and, eventually,
 * its locale. Everything else the package renders is either data from the
 * backend or wording tied to a mechanism the host does not control.
 *
 * Not an i18n framework: a host that needs one renders its own strings into
 * these seven keys.
 */
export interface Labels {
  /** The sidebar's create button (its label when collapsed to an icon). */
  newChat: string;
  /** Why creating a chat / attaching an image is refused with no model loaded. */
  loadModelFirst: string;
  /** Placeholder *and* accessible name of the sidebar's chat search box. */
  filter: string;
  /** The sidebar's "delete every chat" button. */
  deleteAll: string;
  /** Placeholder shown in an empty transcript. */
  startConversation: string;
  /** The button that scrolls a scrolled-away transcript back to the newest row. */
  jumpToLatest: string;
  /**
   * The no-model banner's text when `capabilities.settings === 'hidden'`.
   * The default wording points at Settings, which that host has removed — so
   * this says what a user with no settings panel can actually do instead.
   */
  noModelAvailable: string;
}

export const DEFAULT_LABELS: Labels = {
  newChat: 'New chat',
  loadModelFirst: 'Load a model first',
  filter: 'Filter',
  deleteAll: 'Delete all chats',
  startConversation: 'Start the conversation below.',
  jumpToLatest: 'Jump to latest',
  noModelAvailable: 'No model is available right now — contact your administrator',
};
