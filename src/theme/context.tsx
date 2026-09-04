import { createContext, useContext, type ReactNode } from 'react';

export type ChatTheme = 'light' | 'dark';

const ChatThemeContext = createContext<ChatTheme>('dark');

export function ChatThemeProvider({
  theme,
  children,
}: {
  theme: ChatTheme;
  children: ReactNode;
}) {
  return (
    <ChatThemeContext.Provider value={theme}>{children}</ChatThemeContext.Provider>
  );
}

export function useChatTheme(): ChatTheme {
  return useContext(ChatThemeContext);
}
