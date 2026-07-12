'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { collection, addDoc, updateDoc, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useChat } from '@/lib/ChatContext';

interface Message {
  role: 'user' | 'model';
  content: string;
}

export default function GeminiCoach({ activeRaceId }: { activeRaceId?: string }) {
  const { activeChatId, activeMessages, isCoachOpen, setIsCoachOpen, resetChat, loadChat } = useChat();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Hey! I'm your AI Coach. Ready to crush some goals? Ask me about your progress or how to improve." }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fetchUpcomingRuns = async () => {
    if (coachingMode === 'gemini') {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return [];
        const res = await fetch('/api/gemini-plans', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          return data.plans || [];
        }
      } catch (err) {
        console.error("Coach: Failed to fetch upcoming Gemini plans for context:", err);
      }
      return [];
    }
    
    const token = sessionStorage.getItem('google_calendar_token');
    const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;
    if (!token || !calendarId) return [];

    try {
      const timeMin = new Date().toISOString();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=50`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        return data.items || [];
      }
    } catch (err) {
      console.error("Coach: Failed to fetch upcoming runs for context:", err);
    }
    return [];
  };
  const [coachingMode, setCoachingMode] = useState<'runna' | 'gemini'>('runna');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to coachingMode settings
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        setCoachingMode(docSnap.data().coachingMode || 'runna');
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync with context when a chat is loaded from history
  useEffect(() => {
    if (activeChatId && activeMessages) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setChatId(activeChatId);
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setMessages(activeMessages);
    }
  }, [activeChatId, activeMessages]);

  // Check for pending review chat from upload & custom events
  useEffect(() => {
    const checkPendingChat = async () => {
      const pendingChatId = sessionStorage.getItem('openReviewChatId');
      if (pendingChatId) {
        sessionStorage.removeItem('openReviewChatId');
        try {
          const snap = await getDoc(doc(db, 'chats', pendingChatId));
          if (snap.exists()) {
            const data = snap.data();
            loadChat(snap.id, data.messages);
            setIsCoachOpen(true); // Open chatbot drawer automatically
          }
        } catch (err) {
          console.error("Coach: Failed to load pending review chat:", err);
        }
      }
    };

    checkPendingChat();

    // Listen for custom trigger on the same page
    window.addEventListener('openReviewChat', checkPendingChat);
    return () => {
      window.removeEventListener('openReviewChat', checkPendingChat);
    };
  }, [loadChat, setIsCoachOpen]);



  const fetchCustomEvents = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return [];
      const res = await fetch('/api/custom-events', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        return data.events || [];
      }
    } catch (err) {
      console.error("Coach: Failed to fetch custom events for context:", err);
    }
    return [];
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    // Initial save or update for user message
    let currentChatId = chatId;
    try {
      if (!currentChatId) {
        const docRef = await addDoc(collection(db, 'chats'), {
          timestamp: Date.now(),
          title: input.slice(0, 50) + (input.length > 50 ? '...' : ''),
          messages: updatedMessages
        });
        currentChatId = docRef.id;
        setChatId(currentChatId);
      } else {
        await updateDoc(doc(db, 'chats', currentChatId), {
          messages: updatedMessages
        });
      }
    } catch (saveError) {
      console.error("Coach: Failed to save user message:", saveError);
    }

    try {
      const upcomingRuns = await fetchUpcomingRuns();
      const customEvents = await fetchCustomEvents();
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          messages: updatedMessages,
          upcomingRuns,
          customEvents,
          today: new Date().toISOString(),
          raceId: activeRaceId
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const assistantMessage: Message = { role: 'model', content: data.content };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);

      // Save assistant message
      if (currentChatId) {
        await updateDoc(doc(db, 'chats', currentChatId), {
          messages: finalMessages
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = { role: 'model', content: "Sorry, I had a bit of a cramp. Can you try saying that again?" };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsCoachOpen(!isCoachOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-blue-700 transition-all z-50 animate-bounce-slow"
      >
        {isCoachOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="text-2xl">🤖</span>
        )}
      </button>

      {/* Chat Window */}
      {isCoachOpen && (
        <div className="fixed bottom-24 right-6 w-80 md:w-96 h-[500px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden border border-gray-100 animate-in slide-in-from-bottom-4 duration-300">
          {/* Header */}
          <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
            <div>
              <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                AI Coach
              </h3>
              <p className="text-[10px] text-blue-100 font-bold">Powered by Gemini</p>
            </div>
            <button 
              onClick={() => {
                resetChat();
                setChatId(null);
                setMessages([{ role: 'model', content: "Hey! Ready to start a new consultation? How can I help today?" }]);
              }}
              className="text-[10px] font-black uppercase tracking-widest bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg transition-colors border border-blue-500/30"
              title="Start New Chat"
            >
              New Chat
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] p-4 rounded-2xl text-sm shadow-sm leading-relaxed ${
                  m.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-tr-none font-bold' 
                    : 'bg-white text-gray-900 rounded-tl-none border border-gray-200 font-medium'
                }`}>
                  {m.role === 'model' ? (
                    <div className="prose prose-sm prose-blue max-w-none text-gray-900">
                      <ReactMarkdown
                        components={{
                          strong: ({node, ...props}) => <span className="font-black text-gray-900" {...props} />,
                          p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                          li: ({node, ...props}) => <li className="pl-1" {...props} />,
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-gray-200 shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 bg-white border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask your coach..."
                className="flex-1 p-3 border-2 border-gray-300 rounded-xl text-base font-bold text-gray-900 focus:border-blue-600 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="bg-blue-600 text-white px-4 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
