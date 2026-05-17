'use client';

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

interface PB {
  time: string;
  date: string;
}

interface UserStatsData {
  goals: string[];
  status: string;
  coachingMode: 'runna' | 'gemini';
  pbs: {
    '5k': PB;
    '10k': PB;
    'Half': PB;
    'Marathon': PB;
  };
  lastRace?: {
    time: string;
    distance: string;
    date: string;
  };
  health?: {
    hrv7d: string;
    hrvStatus: string;
    rhr7d: string;
    sleep: string;
    lastUpdated?: string;
  };
  performance?: {
    vo2max: string;
    thresholdPace: string;
    thresholdHR: string;
    lastUpdated?: string;
  };
}

const formatRelativeDate = (dateString?: string) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function UserStats() {
  const [stats, setStats] = useState<UserStatsData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<UserStatsData | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        const rawData = docSnap.data();
        
        const migratePB = (val: string | PB | undefined): PB => {
          if (typeof val === 'string') return { time: val, date: '' };
          return val || { time: '--:--', date: '' };
        };

        // Migration: convert single goal string to goals array
        let goals: string[] = [];
        if (Array.isArray(rawData.goals)) {
          goals = rawData.goals;
        } else if (typeof rawData.goal === 'string' && rawData.goal) {
          goals = [rawData.goal];
        } else if (typeof rawData.goals === 'string' && rawData.goals) {
          goals = [rawData.goals];
        }

        const data: UserStatsData = {
          goals: goals.length > 0 ? goals : ['Set your next goal...'],
          status: rawData.status || 'Maintenance',
          coachingMode: rawData.coachingMode || 'runna',
          pbs: {
            '5k': migratePB(rawData.pbs?.['5k']),
            '10k': migratePB(rawData.pbs?.['10k']),
            'Half': migratePB(rawData.pbs?.['Half']),
            'Marathon': migratePB(rawData.pbs?.['Marathon']),
          },
          lastRace: rawData.lastRace || { time: '--:--', distance: '--', date: '' },
          health: rawData.health || { hrv7d: '--', hrvStatus: 'Balanced', rhr7d: '--', sleep: '--' },
          performance: rawData.performance || { vo2max: '--', thresholdPace: '--:--', thresholdHR: '--' }
        };
        setStats(data);
        setEditForm(data);
      } else {
        const defaults: UserStatsData = {
          goals: ['Set your next goal...'],
          status: 'Maintenance',
          coachingMode: 'runna',
          pbs: {
            '5k': { time: '--:--', date: '' },
            '10k': { time: '--:--', date: '' },
            'Half': { time: '--:--:--', date: '' },
            'Marathon': { time: '--:--:--', date: '' }
          },
          lastRace: { time: '--:--', distance: '--', date: '' },
          health: { hrv7d: '--', hrvStatus: 'Balanced', rhr7d: '--', sleep: '--' },
          performance: { vo2max: '--', thresholdPace: '--:--', thresholdHR: '--' }
        };
        setStats(defaults);
        setEditForm(defaults);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    if (!editForm || !stats) return;
    try {
      const now = new Date().toISOString();
      let finalForm = { ...editForm };

      // 1. Check if health changed
      const healthChanged = 
        editForm.health?.hrv7d !== stats.health?.hrv7d ||
        editForm.health?.hrvStatus !== stats.health?.hrvStatus ||
        editForm.health?.rhr7d !== stats.health?.rhr7d ||
        editForm.health?.sleep !== stats.health?.sleep;
        
      if (healthChanged && editForm.health) {
        finalForm.health = { ...editForm.health, lastUpdated: now };
        await addDoc(collection(db, 'settings', 'user_stats', 'health_history'), {
          ...editForm.health,
          timestamp: now
        });
      }

      // 2. Check if performance changed
      const perfChanged = 
        editForm.performance?.vo2max !== stats.performance?.vo2max ||
        editForm.performance?.thresholdPace !== stats.performance?.thresholdPace ||
        editForm.performance?.thresholdHR !== stats.performance?.thresholdHR;

      if (perfChanged && editForm.performance) {
        finalForm.performance = { ...editForm.performance, lastUpdated: now };
        await addDoc(collection(db, 'settings', 'user_stats', 'performance_history'), {
          ...editForm.performance,
          timestamp: now
        });
      }

      // 3. Save main stats
      await setDoc(doc(db, 'settings', 'user_stats'), finalForm);
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving stats:", error);
    }
  };

  const addGoal = () => {
    if (editForm) {
      setEditForm({
        ...editForm,
        goals: [...editForm.goals, '']
      });
    }
  };

  const updateGoal = (index: number, value: string) => {
    if (editForm) {
      const newGoals = [...editForm.goals];
      newGoals[index] = value;
      setEditForm({ ...editForm, goals: newGoals });
    }
  };

  const removeGoal = (index: number) => {
    if (editForm && editForm.goals.length > 1) {
      const newGoals = editForm.goals.filter((_, i) => i !== index);
      setEditForm({ ...editForm, goals: newGoals });
    }
  };

  if (!stats) return null;

  if (isEditing) {
    return (
      <div className="bg-white shadow-xl rounded-xl p-8 mb-8 border-2 border-blue-500">
        <div className="flex justify-between items-center mb-8 pb-4 border-b">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Update Your Stats</h2>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsEditing(false)} 
              className="px-5 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              className="px-5 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-all active:scale-95"
            >
              Save Dashboard
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Column 1: Goals, Status, Last Race */}
          <div className="space-y-6">
            <div className="bg-blue-50 p-5 rounded-xl border border-blue-200 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-black text-blue-800 uppercase tracking-widest">Your Goals</label>
                <button 
                  onClick={addGoal}
                  className="text-[10px] font-black bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700 transition-all"
                >
                  + ADD
                </button>
              </div>
              <div className="space-y-3">
                {editForm?.goals.map((goal, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input 
                      type="text" 
                      value={goal} 
                      onChange={e => updateGoal(idx, e.target.value)}
                      placeholder="e.g. Sub 20min 5k"
                      className="flex-1 p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white"
                    />
                    {editForm.goals.length > 1 && (
                      <button 
                        onClick={() => removeGoal(idx)}
                        className="text-red-500 hover:text-red-700 px-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="bg-orange-50 p-5 rounded-xl border border-orange-200 shadow-sm">
              <label className="block text-xs font-black text-orange-800 uppercase tracking-widest mb-2">Training Status</label>
              <select 
                value={editForm?.status} 
                onChange={e => setEditForm({...editForm!, status: e.target.value})}
                className="w-full p-3 border-2 border-gray-300 rounded-lg text-lg font-bold text-gray-900 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 focus:outline-none bg-white shadow-inner"
              >
                <option>Base</option>
                <option>Productive</option>
                <option>Peaking</option>
                <option>Recovery</option>
                <option>Maintenance</option>
                <option>Injured</option>
              </select>

              <div className="mt-4 pt-4 border-t border-orange-200">
                <label className="block text-xs font-black text-indigo-800 uppercase tracking-widest mb-2">Coaching Mode</label>
                <div className="flex p-1 bg-white/50 rounded-lg border border-orange-100 shadow-inner">
                  <button
                    onClick={() => setEditForm({...editForm!, coachingMode: 'runna'})}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-md transition-all ${
                      editForm?.coachingMode === 'runna' 
                        ? 'bg-orange-600 text-white shadow-md' 
                        : 'text-orange-400 hover:text-orange-600'
                    }`}
                  >
                    Runna
                  </button>
                  <button
                    onClick={() => setEditForm({...editForm!, coachingMode: 'gemini'})}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-md transition-all ${
                      editForm?.coachingMode === 'gemini' 
                        ? 'bg-orange-600 text-white shadow-md' 
                        : 'text-orange-400 hover:text-orange-600'
                    }`}
                  >
                    Gemini AI
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-purple-50 p-5 rounded-xl border border-purple-200 shadow-sm">
              <label className="block text-xs font-black text-purple-800 uppercase tracking-widest mb-4">Last Race</label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase ml-1">Dist.</span>
                  <input 
                    type="text" 
                    placeholder="10km"
                    value={editForm?.lastRace?.distance} 
                    onChange={e => setEditForm({...editForm!, lastRace: {...editForm!.lastRace!, distance: e.target.value}})}
                    className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-purple-600 focus:outline-none bg-white"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase ml-1">Time</span>
                  <input 
                    type="text" 
                    placeholder="00:00:00"
                    value={editForm?.lastRace?.time} 
                    onChange={e => setEditForm({...editForm!, lastRace: {...editForm!.lastRace!, time: e.target.value}})}
                    className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-purple-600 focus:outline-none bg-white"
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Column 2: Health & Performance */}
          <div className="space-y-6">
            <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm">
              <label className="block text-xs font-black text-emerald-800 uppercase tracking-widest mb-4">Health & Recovery</label>
              <div className="space-y-4">
                {/* HRV Group */}
                <div className="p-3 bg-white/50 rounded-lg border border-emerald-100">
                  <span className="text-[10px] font-black text-emerald-800 uppercase tracking-tight mb-2 block">Heart Rate Variability</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-700 uppercase ml-1">7d Avg</span>
                      <input 
                        type="text" 
                        placeholder="62"
                        value={editForm?.health?.hrv7d} 
                        onChange={e => setEditForm({...editForm!, health: {...editForm!.health!, hrv7d: e.target.value}})}
                        className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-emerald-600 focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-emerald-700 uppercase ml-1">Status</span>
                      <select 
                        value={editForm?.health?.hrvStatus} 
                        onChange={e => setEditForm({...editForm!, health: {...editForm!.health!, hrvStatus: e.target.value}})}
                        className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-emerald-600 focus:outline-none bg-white"
                      >
                        <option>Balanced</option>
                        <option>Unbalanced</option>
                        <option>Low</option>
                        <option>High</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* RHR Group */}
                <div className="p-3 bg-white/50 rounded-lg border border-emerald-100">
                  <span className="text-[10px] font-black text-emerald-800 uppercase tracking-tight mb-2 block">Resting Heart Rate</span>
                  <div>
                    <span className="text-[10px] font-bold text-emerald-700 uppercase ml-1">7d Avg</span>
                    <input 
                      type="text" 
                      placeholder="50"
                      value={editForm?.health?.rhr7d} 
                      onChange={e => setEditForm({...editForm!, health: {...editForm!.health!, rhr7d: e.target.value}})}
                      className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-emerald-600 focus:outline-none bg-white"
                    />
                  </div>
                </div>

                {/* Sleep */}
                <div>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase ml-1">Sleep (7d Avg Score)</span>
                  <input 
                    type="text" 
                    placeholder="e.g. 82"
                    value={editForm?.health?.sleep} 
                    onChange={e => setEditForm({...editForm!, health: {...editForm!.health!, sleep: e.target.value}})}
                    className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-emerald-600 focus:outline-none bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-200 shadow-sm">
              <label className="block text-xs font-black text-indigo-800 uppercase tracking-widest mb-4">Performance Metrics</label>
              <div className="space-y-4">
                {/* VO2 Max Group */}
                <div className="p-3 bg-white/50 rounded-lg border border-indigo-100">
                  <span className="text-[10px] font-black text-indigo-800 uppercase tracking-tight mb-2 block">VO2 Max</span>
                  <div>
                    <input 
                      type="text" 
                      placeholder="e.g. 54.5"
                      value={editForm?.performance?.vo2max} 
                      onChange={e => setEditForm({...editForm!, performance: {...editForm!.performance!, vo2max: e.target.value}})}
                      className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-indigo-600 focus:outline-none bg-white"
                    />
                  </div>
                </div>

                {/* Threshold Group */}
                <div className="p-3 bg-white/50 rounded-lg border border-indigo-100">
                  <span className="text-[10px] font-black text-indigo-800 uppercase tracking-tight mb-2 block">Threshold Numbers</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-indigo-700 uppercase ml-1">Pace (/km)</span>
                      <input 
                        type="text" 
                        placeholder="4:15"
                        value={editForm?.performance?.thresholdPace} 
                        onChange={e => setEditForm({...editForm!, performance: {...editForm!.performance!, thresholdPace: e.target.value}})}
                        className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-indigo-600 focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-indigo-700 uppercase ml-1">Heart Rate</span>
                      <input 
                        type="text" 
                        placeholder="172"
                        value={editForm?.performance?.thresholdHR} 
                        onChange={e => setEditForm({...editForm!, performance: {...editForm!.performance!, thresholdHR: e.target.value}})}
                        className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-900 focus:border-indigo-600 focus:outline-none bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Column 3: Personal Bests */}
          <div>
            <label className="block text-xs font-black text-gray-600 uppercase tracking-widest mb-4 ml-1">Personal Bests</label>
            <div className="space-y-4">
              {(['5k', '10k', 'Half', 'Marathon'] as const).map((key) => (
                <div key={key} className="p-4 bg-white rounded-xl border-2 border-gray-100 shadow-sm">
                  <label className="block text-[10px] font-black text-gray-800 uppercase mb-2 border-b pb-1">
                    {key === 'Marathon' ? 'Full Marathon' : key === 'Half' ? 'Half Marathon' : key}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      placeholder="00:00"
                      value={editForm?.pbs[key].time} 
                      onChange={e => setEditForm({...editForm!, pbs: {...editForm!.pbs, [key]: {...editForm!.pbs[key], time: e.target.value}}})} 
                      className="w-full p-2 border border-gray-200 rounded-lg text-sm font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-gray-50/50" 
                    />
                    <input 
                      type="text" 
                      placeholder="Date"
                      value={editForm?.pbs[key].date} 
                      onChange={e => setEditForm({...editForm!, pbs: {...editForm!.pbs, [key]: {...editForm!.pbs[key], date: e.target.value}}})} 
                      className="w-full p-2 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-gray-50/50" 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {/* Card 1: Goals & Status */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative group flex flex-col justify-between hover:shadow-md transition-shadow">
        <button 
          onClick={() => setIsEditing(true)} 
          className="absolute top-4 right-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-500 z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <div>
          <div className="flex justify-between items-start mb-4">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Training Focus</p>
            <Link 
              href="/status"
              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all hover:scale-105 ${
                stats.status === 'Productive' ? 'bg-green-100 text-green-700' :
                stats.status === 'Peaking' ? 'bg-blue-100 text-blue-700' :
                stats.status === 'Maintenance' ? 'bg-orange-100 text-orange-700' :
                'bg-gray-100 text-gray-700'
              }`}
            >
              {stats.status}
            </Link>
          </div>
          <div className="space-y-2">
            {stats.goals.map((goal, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0 mt-1"></div>
                <p className="text-xs font-black text-gray-800 leading-tight">{goal}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Card 2: Health & Readiness */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative group hover:shadow-md transition-shadow">
        <button 
          onClick={() => setIsEditing(true)} 
          className="absolute top-4 right-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-emerald-500 z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Health & Readiness</p>
            {stats.health?.lastUpdated && (
              <p className="text-[8px] font-bold text-gray-300 uppercase tracking-tight">Updated {formatRelativeDate(stats.health.lastUpdated)}</p>
            )}
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${
            stats.health?.hrvStatus === 'Balanced' ? 'bg-emerald-100 text-emerald-700' :
            stats.health?.hrvStatus === 'Unbalanced' ? 'bg-amber-100 text-amber-700' :
            stats.health?.hrvStatus === 'Low' ? 'bg-red-100 text-red-700' :
            'bg-blue-100 text-blue-700'
          }`}>
            {stats.health?.hrvStatus}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 mt-3">
          <div className="flex justify-between items-end border-b border-gray-50 pb-2">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">HRV (7d Avg)</p>
              <p className="text-xl font-black text-emerald-600 leading-none">
                {stats.health?.hrv7d}<span className="text-[10px] ml-0.5 uppercase">ms</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase">RHR (7d Avg)</p>
              <p className="text-lg font-black text-gray-800 leading-none">
                {stats.health?.rhr7d}<span className="text-[10px] ml-0.5 uppercase">bpm</span>
              </p>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <p className="text-[10px] font-bold text-gray-400 uppercase">Sleep (7d Avg Score)</p>
            <p className="text-sm font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">{stats.health?.sleep}</p>
          </div>
        </div>
      </div>

      {/* Card 3: Performance */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative group hover:shadow-md transition-shadow">
        <button 
          onClick={() => setIsEditing(true)} 
          className="absolute top-4 right-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-500 z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Performance</p>
            {stats.performance?.lastUpdated && (
              <p className="text-[8px] font-bold text-gray-300 uppercase tracking-tight">Updated {formatRelativeDate(stats.performance.lastUpdated)}</p>
            )}
          </div>
        </div>
        <div className="space-y-3 mt-3">
          <div className="bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-100 flex justify-between items-center">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-tighter">VO2 Max</p>
            <p className="text-2xl font-black text-indigo-700 leading-none">{stats.performance?.vo2max}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Threshold Pace</p>
              <p className="text-lg font-black text-gray-800 leading-none">{stats.performance?.thresholdPace}<span className="text-[10px] font-normal text-gray-400 ml-1">/km</span></p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Threshold HR</p>
              <p className="text-lg font-black text-gray-800 leading-none">{stats.performance?.thresholdHR}<span className="text-[10px] font-normal text-gray-400 ml-1">bpm</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Card 4: Records */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative group hover:shadow-md transition-shadow">
        <button 
          onClick={() => setIsEditing(true)} 
          className="absolute top-4 right-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-purple-500 z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <div className="flex justify-between items-center mb-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Personal Bests</p>
          <div className="text-right">
            <p className="text-[8px] font-bold text-purple-400 uppercase tracking-tighter">Last Race</p>
            <p className="text-[10px] font-black text-purple-600 whitespace-nowrap bg-purple-50 px-1.5 py-0.5 rounded">{stats.lastRace?.distance} • {stats.lastRace?.time}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase">5K</span>
            <span className="text-xs font-black text-gray-800">{stats.pbs['5k'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase">10K</span>
            <span className="text-xs font-black text-gray-800">{stats.pbs['10k'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase">Half</span>
            <span className="text-xs font-black text-gray-800">{stats.pbs['Half'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase">Full</span>
            <span className="text-xs font-black text-gray-800">{stats.pbs['Marathon'].time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
