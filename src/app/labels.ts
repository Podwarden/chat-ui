/**
 * Every user-visible string the package renders, grouped by the part of the
 * UI it belongs to. English defaults in `DEFAULT_LABELS`; a host passes any
 * subset through `<ChatApp labels>` and the rest stays English.
 *
 * Not an i18n framework: a host with one renders its own catalog into these
 * keys. Two kinds of value appear:
 *
 *  - a `string` for fixed text;
 *  - a function for text with a value in it (a count, a date, a name). A
 *    number arrives twice — raw, and already formatted for the `locale` prop —
 *    so a host can pick a plural form from the number and print the formatted
 *    string: `(n) => t('key', { count: n })`, or
 *    `(n, f) => selectPlural(locale, n, { one: …, few: …, many: …, other: … })`.
 *
 * Functions rather than `{placeholder}` templates: they type-check (a missing
 * argument is a compile error, not a literal `{count}` on screen), they need no
 * parser, and they leave plural rules to whatever the host already uses.
 *
 * Data is never relabelled: chat titles, model names, backend error messages,
 * tool names and the model's own output are rendered exactly as received.
 */
import type { ErrorCode } from '../contract/events';
import { DEFAULT_SELECTION_LABELS, type SelectionLabels } from '../components/selection/context';
import { PROMPTS } from '../model/selection';

/** A label with a number in it: gets the raw value, then the value formatted for `locale`. */
export type CountLabel = (n: number, formatted: string) => string;

/**
 * The seven strings 0.1.x hosts already set (product vocabulary — "chat" vs
 * "conversation" — and the no-model wording). They stay top-level keys of
 * `labels` so existing hosts keep working unchanged.
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

/** Every string the package renders. */
export interface ChatUiLabels extends Labels {
  /** Buttons shared by several dialogs and banners. */
  common: {
    cancel: string;
    /** A dialog's close (×) button. */
    close: string;
    retry: string;
    dismiss: string;
  };
  /** The bar above the transcript. */
  header: {
    /** Title shown while no chat is open. */
    untitledChat: string;
    /** After an auto-rename: the old title, shown next to the new one. */
    previousTitle: (title: string) => string;
    /** Tooltip of `previousTitle`. */
    previousTitleTooltip: (title: string) => string;
    /** The settings button's accessible name. */
    settings: string;
  };
  composer: {
    placeholder: string;
    /** The compact layout's placeholder (a widget's composer is too narrow for the full one). */
    compactPlaceholder: string;
    /** Placeholder while the composer is blocked and no reason is known. */
    unavailable: string;
    /** The message box's accessible name. */
    messageLabel: string;
    send: string;
    stop: string;
    attachImage: string;
    uploadingImages: string;
    removeFailedImage: string;
    /** Reason line for an expired image draft that carries no message of its own. */
    imageExpired: string;
    /** Why attaching is refused on a model without vision. */
    noVision: string;
    /** Why sending is refused: no chat open (or it is still loading). */
    pickChat: string;
    modelNotLoaded: string;
    contextFull: string;
    budgetExhausted: string;
  };
  /** Image drafts in the composer and images in the transcript. */
  attachments: {
    /** Accessible name of the draft thumbnail list. */
    tray: string;
    uploading: string;
    expired: string;
    failed: string;
    /** A draft's remove button; gets the file name. */
    remove: (fileName: string) => string;
    noChat: string;
    unsupportedType: string;
    /** More files than a message may carry; gets the per-message limit. */
    tooMany: CountLabel;
    /** A file over the size limit; gets the limit in MB. */
    tooLarge: CountLabel;
    uploadFailed: string;
    /** A draft whose upload was evicted before the message was sent. */
    draftExpired: string;
    /** An image in the transcript whose bytes are gone. */
    imageExpired: string;
    /** `alt` of an image in the transcript. */
    imageAlt: string;
    openImage: string;
  };
  /** One row of the transcript. */
  message: {
    /** Name shown above the user's own messages. */
    you: string;
    /** Name above an assistant message whose model is unknown. */
    assistant: string;
    tool: string;
    /** The row's accessible name. */
    ariaLabel: (role: 'user' | 'assistant' | 'tool') => string;
    copy: string;
    copied: string;
    regenerate: string;
    edit: string;
    forkHere: string;
    /** Tooltip of the token counts under a reply. */
    usageTooltip: string;
    /** Appended to estimated token counts. */
    estimated: string;
    /** Shown under a reply that was cut off without an error of its own. */
    connectionLost: string;
  };
  codeBlock: {
    copyCode: string;
    showAll: string;
    collapse: string;
    /** Header of a fence with no language. */
    plainText: string;
  };
  /** Text generated around the model's Markdown. */
  markdown: {
    /** Screen-reader heading of a reply's footnotes section. */
    footnotes: string;
    /**
     * Accessible name of a footnote's back-link. Gets the footnote's number
     * (raw, then formatted for `locale`) and, for a footnote referenced more
     * than once, which reference the link returns to (1, 2, …).
     */
    backToReference: (n: number, formatted: string, occurrence: number) => string;
  };
  reasoning: {
    thinking: string;
    /** After the model stopped thinking; gets whole seconds. */
    thoughtFor: CountLabel;
    /** Accessible name of the reasoning text. */
    ariaLabel: string;
  };
  toolCall: {
    running: string;
    pending: string;
    done: string;
    failed: string;
    /** How long the call took; gets milliseconds. */
    duration: CountLabel;
    arguments: string;
    result: string;
    /** Reveals a capped block; gets its length in characters. */
    showAll: CountLabel;
  };
  /** Choice buttons offered by the model. */
  options: {
    /** Accessible name of a choice group the model gave no question for. */
    groupLabel: string;
    confirm: string;
  };
  /**
   * Heading of an error in the transcript, by error code. A code without an
   * entry is shown as the code itself; the backend's message is shown under it
   * as sent.
   */
  errors: { [K in ErrorCode]?: string };
  /** Screen-reader announcements when a reply ends. */
  thread: {
    responseComplete: string;
    responseStopped: string;
    connectionLost: string;
    /** Gets the backend's error message. */
    error: (message: string) => string;
  };
  /** The notices above the composer. */
  banners: {
    contextFull: string;
    fork: string;
    /** Gets the reset time, formatted for `locale`. */
    budgetExhausted: (resetsAt: string) => string;
    turnInFlight: string;
    connectionLost: string;
    /** Switch the chat to the only loaded model; gets its display name. */
    useModel: (model: string) => string;
    chooseModel: string;
    /** Gets the chat's model id. */
    modelNotLoaded: (model: string) => string;
    pickModel: string;
  };
  /** Failures of sidebar and dialog actions, shown as a dismissible banner. */
  actionErrors: {
    createChat: string;
    renameChat: string;
    deleteChat: string;
    deleteChats: string;
    forkChat: string;
    nothingToFork: string;
    /** "Branch into a new chat" on a message that has no server id yet. */
    cannotBranch: string;
    branchChat: string;
    updateSettings: string;
    saveDefaults: string;
  };
  sidebar: {
    expand: string;
    collapse: string;
    /** Accessible name of the sidebar. */
    region: string;
    /** Accessible name of the chat list. */
    list: string;
    /** Accessible name of the inline rename field. */
    renameField: string;
    today: string;
    yesterday: string;
    last7Days: string;
    older: string;
    /** Group heading for a colleague's chat whose owner has no name. */
    sharedOwner: string;
    answering: string;
    contextFull: string;
    /** Per-row buttons; each gets the chat title. */
    forkChat: (title: string) => string;
    renameChat: (title: string) => string;
    deleteChat: (title: string) => string;
    noChats: string;
    noMatches: string;
    /** Create button tooltip with a scope picker; gets `newChat`, the picker's label and the chosen option. */
    newChatInScope: (newChat: string, scopeLabel: string, option: string) => string;
    /** A row's tooltip after an auto-rename. */
    previousTitleTooltip: (title: string, previous: string) => string;
    deleteTitle: string;
    deleteBody: string;
    deleteConfirm: string;
    deleteAllTitle: string;
    /** Gets how many of the viewer's chats will go. */
    deleteAllBody: CountLabel;
    /** The word the user types to confirm deleting everything; a blank one falls back to the default. */
    deleteAllWord: string;
    /** The instruction around it; the word is shown in bold wherever it appears in the result. */
    deleteAllTypeWord: (word: string) => string;
    /** Accessible name of the confirmation field. */
    deleteAllInput: (word: string) => string;
    deleteAllConfirm: string;
  };
  forkDialog: {
    forkTitle: string;
    editTitle: string;
    /** Gets the number of the last message the fork keeps. */
    forkBody: CountLabel;
    editBody: CountLabel;
    editedMessage: string;
    fork: string;
    forkWithEdit: string;
  };
  settings: {
    region: string;
    heading: string;
    close: string;
    model: string;
    pickModel: string;
    notLoadedGroup: string;
    loadedGroup: string;
    /** The pinned model when it is not loaded; gets its id. */
    notLoadedOption: (model: string) => string;
    pinnedNotLoaded: string;
    pinnedNotLoadedNoneLoaded: string;
    /** Gets the model's context window. */
    contextTokens: CountLabel;
    contextUnknown: string;
    capabilityTools: string;
    capabilityVision: string;
    capabilityReasoning: string;
    textOnly: string;
    /** Gets the input and output price per 1k tokens, formatted for `locale`. */
    pricePer1k: (input: string, output: string) => string;
    temperature: string;
    maxTokens: string;
    topP: string;
    enableThinking: string;
    reasoningEffort: string;
    modelDefault: string;
    /** A stored effort level the current model does not offer; gets the level. */
    effortNotOffered: (level: string) => string;
    systemPrompt: string;
    tools: string;
    skills: string;
    toolPolicy: string;
    maxToolIterations: string;
    toolChoice: string;
    toolChoiceAuto: string;
    toolChoiceNone: string;
    toolChoiceRequired: string;
    toolPolicyNote: string;
    saveDefaults: string;
    applyNote: string;
    /** The "Text selection" section. */
    textSelection: string;
    showSelectionMenu: string;
    menuDelay: string;
    explain: string;
    explainBehaviour: string;
    explainSend: string;
    explainPrefill: string;
    quoteAsChips: string;
    selectionHint: string;
  };
  lightbox: {
    title: string;
    viewport: string;
    zoomIn: string;
    zoomOut: string;
    /** Gets the file size in kB. */
    size: CountLabel;
  };
  /** The context and budget meters in the header and under a streaming reply. */
  meters: {
    contextWindow: string;
    contextTooltip: string;
    /** Gets history + draft, the reserve and the window, formatted for `locale`. */
    contextUsage: (used: string, reserved: string, window: string) => string;
    /** Gets the history size, formatted for `locale`. */
    contextLimitUnknown: (used: string) => string;
    responseTokens: string;
    budget: string;
    /** Gets the reset time, formatted for `locale`. */
    budgetResets: (resetsAt: string) => string;
  };
  /**
   * The instruction lines the built-in selection actions send. They are sent
   * as the user's own message, so they show in the transcript like any other
   * text. The More ▸ actions are set through `selectionActions.quickActions`.
   */
  prompts: {
    explain: string;
    /** Gets the language's display name (in `locale`) and its code. */
    translate: (language: string, code: string) => string;
  };
  /** The text-selection menu, dock, chips and toasts (same keys as `selectionActions.labels`). */
  selection: SelectionLabels;
  /**
   * The three selection texts built around a value, for languages whose word
   * order differs from English. Each function gets the value and then the
   * `selection` string it was built from in 0.1.25 (after
   * `selectionActions.labels`), and returns the whole text. The defaults
   * build exactly the 0.1.25 text, so a host that sets only the `selection`
   * string keeps working; a host that sets the function decides the whole
   * text and may ignore the second argument.
   */
  selectionPhrases: {
    /** The More ▸ Translate item; gets the language name and `selection.translateTo`. */
    translateTo: (language: string, translateTo: string) => string;
    /** A quote chip's remove button; gets the quote's preview and `selection.removeQuote`. */
    removeQuote: (preview: string, removeQuote: string) => string;
    /** Announced the first time the menu appears; gets `SELECTION_SHORTCUT` and `selection.available`. */
    available: (shortcut: string, available: string) => string;
  };
  /** `<ChatWidget>`'s launcher and panel, and the compact layout's chat-list drawer. */
  widget: {
    /** The launcher button while the panel is closed. */
    open: string;
    /** The launcher button and the panel's × while it is open. */
    close: string;
    /** The panel's heading (and its accessible name) when the host passes no `title`. */
    title: string;
    /** The panel's link to the full-page chat (`fullPageHref`). */
    openFullPage: string;
    /** On the launcher while a reply streams with the panel closed. */
    answering: string;
    /** On the launcher after a reply finished with the panel closed. */
    unread: string;
    /** The compact layout's header button that opens the chat list. */
    showChats: string;
  };
}

/** Any subset of `ChatUiLabels`; each group is merged key by key over the defaults. */
export type ChatUiLabelOverrides = {
  [K in keyof ChatUiLabels]?: ChatUiLabels[K] extends string ? string : Partial<ChatUiLabels[K]>;
};

export const DEFAULT_LABELS: ChatUiLabels = {
  newChat: 'New chat',
  loadModelFirst: 'Load a model first',
  filter: 'Filter',
  deleteAll: 'Delete all chats',
  startConversation: 'Start the conversation below.',
  jumpToLatest: 'Jump to latest',
  noModelAvailable: 'No model is available right now — contact your administrator',
  common: {
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    dismiss: 'Dismiss',
  },
  header: {
    untitledChat: 'Chat',
    previousTitle: (title) => `(was: ${title})`,
    previousTitleTooltip: (title) => `was: ${title}`,
    settings: 'Settings',
  },
  composer: {
    placeholder: 'Message… (Enter to send, Shift+Enter for newline, drop or paste images)',
    compactPlaceholder: 'Message…',
    unavailable: 'Unavailable',
    messageLabel: 'Message',
    send: 'Send',
    stop: 'Stop',
    attachImage: 'Attach image',
    uploadingImages: 'Uploading images…',
    removeFailedImage: 'Remove the failed image to send',
    imageExpired: 'An image expired — remove it and attach again',
    noVision: "This model can't see images",
    pickChat: 'Create or pick a chat',
    modelNotLoaded: 'Model is not loaded',
    contextFull: 'Context window is full — fork to continue',
    budgetExhausted: 'Budget exhausted',
  },
  attachments: {
    tray: 'Attached images',
    uploading: 'uploading…',
    expired: 'expired',
    failed: 'failed',
    remove: (fileName) => `Remove ${fileName}`,
    noChat: 'Pick a chat first',
    unsupportedType: 'Only PNG, JPEG or WebP images are supported',
    tooMany: (_n, max) => `Only ${max} images per message`,
    tooLarge: (_n, mb) => `Image exceeds ${mb} MB`,
    uploadFailed: 'Upload failed',
    draftExpired: 'This image expired — remove it and attach again',
    imageExpired: 'image expired',
    imageAlt: 'attached image',
    openImage: 'Open image',
  },
  message: {
    you: 'you',
    assistant: 'assistant',
    tool: 'tool',
    ariaLabel: (role) => `${role} message`,
    copy: 'Copy',
    copied: 'Copied',
    regenerate: 'Regenerate',
    edit: 'Edit (forks the chat)',
    forkHere: 'Fork here',
    usageTooltip: 'prompt / completion / reasoning tokens',
    estimated: '(est.)',
    connectionLost: 'Connection lost',
  },
  codeBlock: {
    copyCode: 'Copy code',
    showAll: 'Show all',
    collapse: 'Collapse',
    plainText: 'text',
  },
  markdown: {
    footnotes: 'Footnotes',
    backToReference: (_n, ref, occurrence) => `Back to reference ${ref}${occurrence > 1 ? `-${occurrence}` : ''}`,
  },
  reasoning: {
    thinking: 'Thinking…',
    thoughtFor: (_n, s) => `Thought for ${s} s`,
    ariaLabel: 'model reasoning',
  },
  toolCall: {
    running: 'running',
    pending: 'pending',
    done: 'done',
    failed: 'failed',
    duration: (_n, ms) => `${ms} ms`,
    arguments: 'arguments',
    result: 'result',
    showAll: (_n, chars) => `Show all (${chars} chars)`,
  },
  options: {
    groupLabel: 'Options',
    confirm: 'Confirm',
  },
  errors: {
    guard: 'Stopped by the runaway guard',
    timeout: 'The model took too long',
    rate_limited: 'Rate limited — try again shortly',
    context_full: 'Context window is full — fork to continue',
    budget_blocked: 'Budget exhausted',
    model_not_loaded: 'Model is not loaded',
    turn_in_flight: 'Another turn is already running for this chat',
    attachment_missing: 'An attached image is gone',
    tools_unsupported: 'This model cannot use tools',
    too_many_images: 'Too many images (max 8)',
    upstream: 'The model returned an error',
    internal: 'Something went wrong',
  },
  thread: {
    responseComplete: 'Response complete',
    responseStopped: 'Response stopped',
    connectionLost: 'Connection lost',
    error: (message) => `Error: ${message}`,
  },
  banners: {
    contextFull: 'Context window is full. The chat stays readable; fork it to continue.',
    fork: 'Fork',
    budgetExhausted: (resetsAt) => `Budget exhausted — resets ${resetsAt}.`,
    turnInFlight: 'Another turn is running for this chat (maybe in another tab).',
    connectionLost: 'Connection lost — retry?',
    useModel: (model) => `Use ${model}`,
    chooseModel: 'Choose a model',
    modelNotLoaded: (model) => `Model "${model}" is not loaded.`,
    pickModel: 'Pick a model in Settings.',
  },
  actionErrors: {
    createChat: 'Could not create the chat',
    renameChat: 'Could not rename the chat',
    deleteChat: 'Could not delete the chat',
    deleteChats: 'Could not delete the chats',
    forkChat: 'Could not fork the chat',
    nothingToFork: 'That chat has no messages to fork yet.',
    cannotBranch: 'That message cannot be branched from yet.',
    branchChat: 'Could not branch the chat',
    updateSettings: 'Could not update the chat settings',
    saveDefaults: 'Could not save the defaults',
  },
  sidebar: {
    expand: 'Expand chat list',
    collapse: 'Collapse chat list',
    region: 'Chats',
    list: 'Chat list',
    renameField: 'Rename chat',
    today: 'Today',
    yesterday: 'Yesterday',
    last7Days: 'Last 7 days',
    older: 'Older',
    sharedOwner: 'Shared',
    answering: 'answering…',
    contextFull: 'Context full',
    forkChat: (title) => `Fork ${title}`,
    renameChat: (title) => `Rename ${title}`,
    deleteChat: (title) => `Delete ${title}`,
    noChats: 'No chats yet.',
    noMatches: 'No chats match.',
    newChatInScope: (newChat, scopeLabel, option) => `${newChat} · ${scopeLabel}: ${option}`,
    previousTitleTooltip: (title, previous) => `${title} (was: ${previous})`,
    deleteTitle: 'Delete chat?',
    deleteBody: 'This deletes the chat and its images. This cannot be undone.',
    deleteConfirm: 'Delete',
    deleteAllTitle: 'Delete all chats?',
    deleteAllBody: (_n, count) => `All ${count} of your chats and their images will be deleted.`,
    deleteAllWord: 'DELETE',
    deleteAllTypeWord: (word) => `Type ${word} to confirm.`,
    deleteAllInput: (word) => `Type ${word} to confirm`,
    deleteAllConfirm: 'Delete everything',
  },
  forkDialog: {
    forkTitle: 'Fork chat',
    editTitle: 'Edit and fork',
    forkBody: (_n, seq) => `A new chat is created with messages up to #${seq}. The original is unchanged.`,
    editBody: (_n, seq) => `A new chat is created with messages up to #${seq}, followed by your edited message.`,
    editedMessage: 'Edited message',
    fork: 'Fork',
    forkWithEdit: 'Fork with edit',
  },
  settings: {
    region: 'Chat settings',
    heading: 'Settings',
    close: 'Close settings',
    model: 'Model',
    pickModel: '— pick a model —',
    notLoadedGroup: 'Not loaded',
    loadedGroup: 'Loaded',
    notLoadedOption: (model) => `${model} (not loaded)`,
    pinnedNotLoaded: 'This chat is pinned to a model that is not loaded. Pick a loaded one to continue.',
    pinnedNotLoadedNoneLoaded: 'This chat is pinned to a model that is not loaded, and nothing else is loaded yet.',
    contextTokens: (_n, tokens) => `${tokens} tokens`,
    contextUnknown: 'context unknown',
    capabilityTools: 'tools',
    capabilityVision: 'vision',
    capabilityReasoning: 'reasoning',
    textOnly: 'text only',
    pricePer1k: (input, output) => `${input}/${output} per 1k`,
    temperature: 'Temperature',
    maxTokens: 'Max tokens',
    topP: 'Top p',
    enableThinking: 'Enable thinking',
    reasoningEffort: 'Reasoning effort',
    modelDefault: 'Model default',
    effortNotOffered: (level) => `${level} (not offered by this model)`,
    systemPrompt: 'System prompt',
    tools: 'Tools',
    skills: 'Skills',
    toolPolicy: 'Tool policy',
    maxToolIterations: 'Max tool iterations',
    toolChoice: 'Tool choice',
    toolChoiceAuto: 'auto',
    toolChoiceNone: 'none',
    toolChoiceRequired: 'required',
    toolPolicyNote: 'When the budget runs out the agent always answers once more without tools.',
    saveDefaults: 'Save as my defaults',
    applyNote: 'Changes apply to the next turn and are snapshotted on each message.',
    textSelection: 'Text selection',
    showSelectionMenu: 'Show menu when selecting text',
    menuDelay: 'Menu delay (ms)',
    explain: 'Explain',
    explainBehaviour: 'Explain behaviour',
    explainSend: 'Send straight away',
    explainPrefill: 'Put in the message box',
    quoteAsChips: 'Collect quotes as chips',
    selectionHint: 'Saved in this browser. With text selected, press Alt+Enter (Option+Return on a Mac) for the menu.',
  },
  lightbox: {
    title: 'Image preview',
    viewport: 'Image viewport — scroll to zoom, drag to pan',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    size: (_n, kb) => `${kb} kB`,
  },
  meters: {
    contextWindow: 'Context window',
    contextTooltip: 'context window',
    contextUsage: (used, reserved, window) => `${used} + ${reserved} reserved / ${window}`,
    contextLimitUnknown: (used) => `${used} tokens · limit unknown`,
    responseTokens: 'Response tokens',
    budget: 'Budget',
    budgetResets: (resetsAt) => `resets ${resetsAt}`,
  },
  prompts: {
    explain: PROMPTS.explain,
    translate: (language) => `${PROMPTS.translate} ${language}:`,
  },
  selection: DEFAULT_SELECTION_LABELS,
  selectionPhrases: {
    translateTo: (language, translateTo) => `${translateTo} ${language}`,
    removeQuote: (preview, removeQuote) => `${removeQuote}: ${preview}`,
    available: (shortcut, available) => `${available} ${shortcut}.`,
  },
  widget: {
    open: 'Open chat',
    close: 'Close chat',
    title: 'Chat',
    openFullPage: 'Open full page',
    answering: 'Answering…',
    unread: 'New reply',
    showChats: 'Show chats',
  },
};

/**
 * `DEFAULT_LABELS` with `overrides` laid over it: top-level strings replace,
 * groups merge key by key (an override group never drops the defaults it does
 * not mention). A catalog loaded at runtime is not type-checked, so every
 * value must have the type of the default it replaces — a string for a
 * string, a function for a function; anything else (`undefined`, `null`, a
 * number, a string where a function belongs) is skipped and that label stays
 * English instead of rendering "undefined" or throwing during render. Keys the
 * defaults do not have are ignored, except in `errors`, which takes a string
 * for any error code. Only own keys count, so a `"__proto__"` key in a JSON
 * catalog is ignored too.
 */
export function mergeLabels(overrides?: ChatUiLabelOverrides | null): ChatUiLabels {
  if (!overrides) return DEFAULT_LABELS;
  const defaults = DEFAULT_LABELS as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || !Object.hasOwn(defaults, key)) continue;
    const base = defaults[key];
    if (typeof base === 'string') {
      if (typeof value === 'string') out[key] = value;
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const baseGroup = base as Record<string, unknown>;
    const group: Record<string, unknown> = { ...baseGroup };
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const known = Object.hasOwn(baseGroup, k);
      if (known ? typeof v === typeof baseGroup[k] : key === 'errors' && typeof v === 'string' && k !== '__proto__') group[k] = v;
    }
    out[key] = group;
  }
  return out as unknown as ChatUiLabels;
}
