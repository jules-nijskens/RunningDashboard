'use client';

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

const DEFAULT_REPORT = `Your training is currently focused on transitioning from a high-volume base into a specialized 10K speed block, managed for your 194 cm frame and senior PM lifestyle in Berlin.

1. Current Training Phase & Objectives
- Current Phase: Transitioning from half-marathon base to 10K specific speed-work.
- Primary Objective: Sub-47:30 10K at the Adidas run on August 1st.
- Secondary Objective: Establishing a sub-1:45 half-marathon base for late October.
- Volume Target: 40–45 km per week, peaking at 50 km in mid-July.

2. Physiological Status & Fitness
- Aerobic Base: Strong foundation established with recent 22km long runs and efficient recovery efforts (avg 146-149 bpm).
- Threshold Metrics: Estimated Lactate Threshold Heart Rate (LTHR) is 176 bpm, with a max range of 192–196 bpm.
- Environmental Factors: Notable cardiovascular drift in warm weather (>20°C), typically appearing after 13km of direct exposure.
- Recovery State: Currently managing high accumulated fatigue from an extended 4-week load block.

3. Biomechanics & Form Trends
- Cadence Evolution: Easy run "autopilot" has successfully risen to 165 spm, significantly improving efficiency from 2025 levels.
- Vertical Oscillation: Improved "gliding" mechanics have reduced bounce from 9.9 cm to 8.5 cm, lowering structural impact.
- Ground Contact: Current GCT remains around 288 ms during easy efforts; focus remains on reducing this as intensity increases.

4. Short-Term Strategy (Next 2-3 Weeks)
- Immediate Focus: Completing the current "Triple Load" block and preparing for a baseline 5km Time Trial.
- Upcoming Test: Friday 5km Time Trial (Target: 4:30–4:35/km) to set training zones for the upcoming speed block.
- Strength Integration: Maintaining 2 office sessions (Mon/Wed) and 1 home stability session (Sat) to support increased interval intensity.
- Adjustments: Sunday long runs are temporarily capped at 18km to accommodate Time Trial recovery.`;

export default function StatusPage() {
  const [content, setContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'training_report'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setContent(data.content || DEFAULT_REPORT);
        setEditValue(data.content || DEFAULT_REPORT);
      } else {
        setContent(DEFAULT_REPORT);
        setEditValue(DEFAULT_REPORT);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    try {
      await setDoc(doc(db, 'settings', 'training_report'), { content: editValue });
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving report:", error);
      alert("Failed to save report.");
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center font-black uppercase tracking-widest text-gray-600">Loading Report...</div>;

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 text-gray-900">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <Link href="/" className="inline-flex items-center text-sm font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest group">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 transform group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Dashboard
          </Link>
          
          <button 
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            className={`px-6 py-2 rounded-xl font-black uppercase text-xs tracking-widest transition-all active:scale-95 shadow-lg ${
              isEditing ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {isEditing ? 'Save Changes' : 'Edit Report'}
          </button>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="bg-gray-900 p-10 text-white relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600 rounded-full blur-[120px] opacity-20 -mr-32 -mt-32"></div>
            <p className="text-xs font-black text-blue-400 uppercase tracking-[0.3em] mb-4">Confidential</p>
            <h1 className="text-4xl font-black tracking-tight">Athlete Training Status & Strategy</h1>
            <p className="text-gray-300 mt-2 font-bold uppercase text-[10px] tracking-widest">Berlin Performance Lab • {new Date().toLocaleDateString()}</p>
          </div>

          <div className="p-10 md:p-16">
            {isEditing ? (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full min-h-[600px] p-8 border-2 border-blue-100 rounded-2xl font-mono text-lg leading-relaxed focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none bg-white text-gray-900 shadow-inner"
                placeholder="Write your training update here..."
              />
            ) : (
              <div className="prose prose-blue max-w-none">
                {content.split('\n').map((line, i) => {
                  if (!line.trim()) return <br key={i} />;
                  
                  // Simple markdown-style detection for headers
                  if (line.match(/^\d+\./)) {
                    return <h2 key={i} className="text-2xl font-black text-gray-900 mt-10 mb-4 border-b-2 border-gray-100 pb-2 uppercase tracking-tight">{line}</h2>;
                  }
                  
                  if (line.trim().startsWith('- ')) {
                    return (
                      <div key={i} className="flex items-start gap-3 mb-2 ml-4">
                        <div className="mt-1.5 w-1.5 h-1.5 bg-blue-600 rounded-full shrink-0"></div>
                        <p className="text-gray-900 font-medium leading-relaxed">
                          <span className="font-bold text-gray-900">{line.split(':')[0]}:</span>
                          {line.split(':').slice(1).join(':')}
                        </p>
                      </div>
                    );
                  }

                  return <p key={i} className="text-gray-900 text-lg leading-relaxed mb-4 font-medium">{line}</p>;
                })}
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">Proprietary Training Data • Authorized Access Only</p>
        </div>
      </div>
    </main>
  );
}
