'use client';

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

const DEFAULT_REPORT = `Your training is currently at a critical pivot point, transitioning from a high-volume half-marathon base into a specialized 10K speed block. You are managing this transition as a 194 cm runner based in Oranienburg, Netherlands-born, and working as a senior product manager in Berlin.

1. Physiological Profile & Base
- Heart Rate Metrics: Your Lactate Threshold Heart Rate (LTHR) is 176 bpm, with a likely maximum range of 192–196 bpm.
- Current Aerobic State: You have established a strong aerobic foundation, recently completing a 22km long run (avg 149 bpm) and an efficient 10km recovery run (avg 146 bpm).
- Thermal Sensitivity: Recent data shows a significant cardiovascular drift during warm-weather runs, with heart rate increases noted around the 13km mark when exposed to direct sun.

2. Biomechanical Evolution (2025 vs. 2026)
Data comparisons between your late 2025 races and your current 2026 runs show significant mechanical improvements:
- Cadence: Your "Easy" autopilot has risen to 165 spm, which is nearly as fast as your 5K race turnover was in September 2025 (166.8 spm).
- Efficiency: You have reduced your vertical oscillation (bounce) from 9.9 cm during your October 2025 10K race to 8.5 cm during recent easy runs.
- Impact Management: While your Ground Contact Time (GCT) is currently higher during easy runs (≈288 ms), your improved "gliding" mechanics reduce the total structural load on your long levers.

3. Immediate Strategy: The "Triple Load" Week
You are currently in a high-fatigue "Week 4" after postponing your deload by one week.
- Recent Load: You completed a tough 22km Sunday effort followed by a 10km run and an office strength workout on Tuesday.
- Upcoming Test: A 5km Time Trial is scheduled for Friday, with a target pace of approximately 4:30–4:35/km to establish a baseline for your speed block.
- Weekend Adjustment: To accommodate the time trial fatigue, your Sunday long run has been capped at 18km.

4. Long-Term Roadmap (August 1st Race)
Following your mid-May holiday, you will begin an 11-week Runna 10K training plan:
- Primary Goal: Sub-47:30 10K at the Adidas run on August 1st.
- Training Volume: Weekly mileage will aim for 40–45 km, peaking at 50 km in mid-July.
- Strength Routine: You are maintaining a 2+1 structure consisting of two office workouts (Monday/Wednesday) and one home stability session (Saturday) to protect your joints during higher-intensity intervals.
- Next Milestone: Sub-1:45 half-marathon attempt in late October.`;

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
