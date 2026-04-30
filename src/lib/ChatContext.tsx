'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface Message {
  role: 'user' | 'model';
  content: string;
}

interface ChatContextType {
  activeChatId: string | null;
  activeMessages: Message[] | null;
  isCoachOpen: boolean;
  loadChat: (id: string, messages: Message[]) => void;
  setIsCoachOpen: (isOpen: boolean) => void;
  resetChat: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<Message[] | null>(null);
  const [isCoachOpen, setIsCoachOpen] = useState(false);

  const loadChat = (id: string, messages: Message[]) => {
    setActiveChatId(id);
    setActiveMessages(messages);
    setIsCoachOpen(true);
  };

  const resetChat = () => {
    setActiveChatId(null);
    setActiveMessages(null);
  };

  return (
    <ChatContext.Provider value={{ 
      activeChatId, 
      activeMessages, 
      isCoachOpen, 
      loadChat, 
      setIsCoachOpen,
      resetChat 
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
