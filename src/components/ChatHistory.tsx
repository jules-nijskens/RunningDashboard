'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Chat } from '@/types/run';
import ReactMarkdown from 'react-markdown';
import { useChat } from '@/lib/ChatContext';

export default function ChatHistory() {
  const { loadChat } = useChat();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'chats'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Chat[];
      setChats(chatData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="py-10 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Loading Coach Logs...</p>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="bg-white p-12 rounded-3xl shadow-xl border border-gray-100 text-center">
        <span className="text-4xl mb-4 block">🧠</span>
        <h3 className="text-xl font-black text-gray-900 mb-2">No Coach Logs Yet</h3>
        <p className="text-gray-600 font-medium">Start a conversation with the AI Coach to see your logs here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-2">
        <h2 className="text-2xl font-bold text-gray-800">Coach Conversations</h2>
        <span className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] bg-blue-50 px-3 py-1 rounded-full">Archive</span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {chats.map((chat) => (
          <div 
            key={chat.id} 
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all relative"
          >
            <div className="absolute top-6 right-16 z-10 flex gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  loadChat(chat.id!, chat.messages);
                }}
                className="bg-blue-50 hover:bg-blue-100 text-blue-600 p-2 rounded-lg transition-colors border border-blue-100 group/btn"
                title="Continue Conversation"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-1">
                  <span className="group-hover/btn:scale-110 transition-transform">🧠</span>
                  Continue
                </span>
              </button>
            </div>
            
            <button 
              onClick={() => setExpandedChatId(expandedChatId === chat.id ? null : chat.id!)}
              className="w-full p-6 text-left flex justify-between items-center group"
            >
              <div className="flex-1 pr-32">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {new Date(chat.timestamp).toLocaleDateString('en-GB', { 
                      weekday: 'short', 
                      day: '2-digit', 
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <div className="h-1 w-1 bg-gray-300 rounded-full"></div>
                  <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                    {chat.messages.length} Messages
                  </span>
                </div>
                <h3 className="text-lg font-black text-gray-900 group-hover:text-blue-600 transition-colors">
                  {chat.title || "Coach Consultation"}
                </h3>
              </div>
              <div className={`transform transition-transform ${expandedChatId === chat.id ? 'rotate-180' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {expandedChatId === chat.id && (
              <div className="px-6 pb-8 pt-2 space-y-6 border-t border-gray-50 bg-gray-50/30">
                {chat.messages.map((m, idx) => (
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
                          </ReactMarkdown>                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
