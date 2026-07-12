'use client';

import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Race } from '@/types/run';
import Link from 'next/link';
import { Trophy, Calendar, MapPin, Target, Sparkles, Loader2, Trash2, ArrowRight } from 'lucide-react';

export default function RaceDashboard() {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form State
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [targetDistance, setTargetDistance] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [strategyGoal, setStrategyGoal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'races'), orderBy('date', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const raceList: Race[] = [];
      snapshot.forEach((docSnap) => {
        raceList.push({ id: docSnap.id, ...docSnap.data() } as Race);
      });
      setRaces(raceList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (window.confirm('Are you sure you want to delete this race plan?')) {
      try {
        await deleteDoc(doc(db, 'races', id));
      } catch (err) {
        console.error("Failed to delete race:", err);
        alert("Failed to delete race.");
      }
    }
  };

  const handleCreateRace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !date || !targetDistance || !targetTime) return;

    setIsSubmitting(true);
    setMessage(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      
      // 1. Generate AI Coach Pre-Race Preview
      setMessage({ type: 'success', text: 'Generating bespoke pacing strategy with AI Coach...' });
      const previewRes = await fetch('/api/races/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          date,
          targetDistance: parseFloat(targetDistance),
          targetTime,
          strategyGoal
        })
      });

      let coachPreview = "";
      if (previewRes.ok) {
        const previewData = await previewRes.json();
        coachPreview = previewData.preview;
      } else {
        console.warn("Failed to generate AI preview, creating race without it.");
      }

      // 2. Create Chat History for Race strategy discussion
      let strategyChatId = "";
      if (coachPreview) {
        try {
          const chatRef = await addDoc(collection(db, 'chats'), {
            timestamp: Date.now(),
            title: `Strategy: ${name}`,
            messages: [
              { role: 'user', content: `I am planning a new race: ${name}. It is a ${targetDistance} km race and my target time is ${targetTime}. Strategy notes: ${strategyGoal || 'None'}. Could you give me a strategy plan?` },
              { role: 'model', content: coachPreview }
            ]
          });
          strategyChatId = chatRef.id;
        } catch (chatError) {
          console.error("Failed to create strategy chat history:", chatError);
        }
      }

      // 3. Save Race Document to Firestore
      const newRace: Race = {
        name,
        date,
        targetDistance: parseFloat(targetDistance),
        targetTime,
        strategyGoal,
        coachPreview,
        status: 'planned',
        timestamp: new Date(date).getTime(),
        strategyChatId
      };

      await addDoc(collection(db, 'races'), newRace);

      setMessage({ type: 'success', text: 'Race planned and pacing guide generated successfully!' });
      setTimeout(() => {
        setShowAddForm(false);
        setName('');
        setDate('');
        setTargetDistance('');
        setTargetTime('');
        setStrategyGoal('');
        setMessage(null);
      }, 1500);
    } catch (err: any) {
      console.error("Error creating race:", err);
      setMessage({ type: 'error', text: err.message || 'Failed to create race.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-500 font-medium animate-pulse">Loading races...</div>;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Race Plans</h2>
          <p className="text-gray-600 text-sm mt-1">Plan your races, outline targets, and get AI pacing guidelines.</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 text-sm gap-2"
        >
          <Trophy className="w-4 h-4" />
          {showAddForm ? 'View Races' : 'Plan A Race'}
        </button>
      </div>

      {showAddForm ? (
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 max-w-2xl mx-auto">
          <h3 className="text-xl font-black text-gray-900 mb-6 border-b pb-4 tracking-tight flex items-center gap-2">
            <Trophy className="text-blue-600 w-5 h-5" />
            Plan New Race
          </h3>
          <form onSubmit={handleCreateRace} className="space-y-5">
            <div className="space-y-1">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-widest">Race Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Berlin Marathon 2026"
                className="w-full p-3.5 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-black text-gray-700 uppercase tracking-widest">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full p-3.5 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner"
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-black text-gray-700 uppercase tracking-widest">Target Distance (km)</label>
                <input
                  type="number"
                  step="0.01"
                  value={targetDistance}
                  onChange={(e) => setTargetDistance(e.target.value)}
                  placeholder="e.g. 42.2 or 10"
                  className="w-full p-3.5 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-widest">Target Time (HH:MM:SS / MM:SS)</label>
              <input
                type="text"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                placeholder="e.g. 03:45:00 or 47:30"
                className="w-full p-3.5 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-widest">Strategy, Nutrition & Shoe Goals</label>
              <textarea
                value={strategyGoal}
                onChange={(e) => setStrategyGoal(e.target.value)}
                placeholder="List your hydration points, gel strategy, shoes to wear, or secondary time targets..."
                className="w-full p-4 border-2 border-gray-300 rounded-xl text-lg font-medium text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner min-h-[120px]"
                disabled={isSubmitting}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 px-6 rounded-xl text-white font-black text-lg shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${
                isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-100'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Strategy...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Plan & Generate AI Strategy
                </>
              )}
            </button>

            {message && (
              <div className={`p-4 rounded-xl text-center font-bold shadow-sm border-2 ${
                message.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'
              }`}>
                {message.text}
              </div>
            )}
          </form>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {races.length === 0 ? (
            <div className="col-span-full bg-white p-12 rounded-2xl text-center border-2 border-dashed border-gray-200">
              <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-700 font-bold text-lg">No races planned yet.</p>
              <p className="text-gray-500 text-sm mt-1 mb-6">Create a race event to prepare custom pacing and fuel guides.</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-sm text-sm"
              >
                Plan Your First Race
              </button>
            </div>
          ) : (
            races.map((race) => (
              <Link 
                href={`/races/${race.id}`} 
                key={race.id}
                className="group block bg-white p-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-lg hover:border-blue-100 transition-all relative overflow-hidden"
              >
                {/* Status indicator bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-2.5 ${race.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`} />
                
                <div className="pl-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                        race.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {race.status}
                      </span>
                      <h4 className="text-lg font-black text-gray-900 mt-2.5 group-hover:text-blue-600 transition-colors">{race.name}</h4>
                    </div>
                    <button
                      onClick={(e) => race.id && handleDelete(e, race.id)}
                      className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete race plan"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-6 border-t pt-4 border-gray-50">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-[10px] text-gray-600 uppercase font-black tracking-wider">Date</p>
                        <p className="text-sm font-bold text-gray-900">{race.date}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-[10px] text-gray-600 uppercase font-black tracking-wider">Distance</p>
                        <p className="text-sm font-bold text-gray-900">{race.targetDistance} km</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <Trophy className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-[10px] text-gray-600 uppercase font-black tracking-wider">Target Time</p>
                        <p className="text-sm font-black text-gray-900">{race.targetTime}</p>
                      </div>
                    </div>

                    {race.status === 'completed' && (
                      <div className="flex items-center gap-2 mt-2">
                        <Sparkles className="w-4 h-4 text-green-500" />
                        <div>
                          <p className="text-[10px] text-green-700 uppercase font-black tracking-wider">Status</p>
                          <p className="text-sm font-black text-green-600">Reviewed</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex justify-between items-center text-xs font-bold text-blue-600 group-hover:translate-x-1 transition-transform">
                    <span>{race.status === 'completed' ? 'View Post-Race Comparison' : 'View Pacing Strategy & Link Run'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
