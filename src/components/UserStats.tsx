'use client';

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

interface PB {
  time: string;
  date: string;
}

interface UserStatsData {
  goals: string[];
  status: string;
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
}

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
          pbs: {
            '5k': migratePB(rawData.pbs?.['5k']),
            '10k': migratePB(rawData.pbs?.['10k']),
            'Half': migratePB(rawData.pbs?.['Half']),
            'Marathon': migratePB(rawData.pbs?.['Marathon']),
          },
          lastRace: rawData.lastRace || { time: '--:--', distance: '--', date: '' }
        };
        setStats(data);
        setEditForm(data);
      } else {
        const defaults: UserStatsData = {
          goals: ['Set your next goal...'],
          status: 'Maintenance',
          pbs: {
            '5k': { time: '--:--', date: '' },
            '10k': { time: '--:--', date: '' },
            'Half': { time: '--:--:--', date: '' },
            'Marathon': { time: '--:--:--', date: '' }
          },
          lastRace: { time: '--:--', distance: '--', date: '' }
        };
        setStats(defaults);
        setEditForm(defaults);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    if (!editForm) return;
    try {
      await setDoc(doc(db, 'settings', 'user_stats'), editForm);
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
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-1 space-y-6">
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
            </div>

            <div className="bg-purple-50 p-5 rounded-xl border border-purple-200 shadow-sm">
              <label className="block text-xs font-black text-purple-800 uppercase tracking-widest mb-4">Last Race Results</label>
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase ml-1">Distance</span>
                  <input 
                    type="text" 
                    placeholder="e.g. 15km"
                    value={editForm?.lastRace?.distance} 
                    onChange={e => setEditForm({...editForm!, lastRace: {...editForm!.lastRace!, distance: e.target.value}})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg text-lg font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 focus:outline-none bg-white shadow-inner"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase ml-1">Time</span>
                  <input 
                    type="text" 
                    placeholder="00:00:00"
                    value={editForm?.lastRace?.time} 
                    onChange={e => setEditForm({...editForm!, lastRace: {...editForm!.lastRace!, time: e.target.value}})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg text-lg font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 focus:outline-none bg-white shadow-inner"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase ml-1">Date</span>
                  <input 
                    type="date" 
                    value={editForm?.lastRace?.date} 
                    onChange={e => setEditForm({...editForm!, lastRace: {...editForm!.lastRace!, date: e.target.value}})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg text-lg font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 focus:outline-none bg-white shadow-inner"
                  />
                </div>
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-3">
            <label className="block text-xs font-black text-gray-600 uppercase tracking-widest mb-4 ml-1">Personal Bests & Records</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(['5k', '10k', 'Half', 'Marathon'] as const).map((key) => (
                <div key={key} className="p-6 bg-white rounded-2xl border-2 border-gray-100 shadow-sm hover:border-blue-200 transition-colors">
                  <label className="block text-sm font-black text-gray-800 uppercase mb-4 border-b pb-2">
                    {key === 'Marathon' ? 'Full Marathon' : key === 'Half' ? 'Half Marathon' : key}
                  </label>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-gray-600 uppercase ml-1">Time</span>
                      <input 
                        type="text" 
                        placeholder="00:00:00"
                        value={editForm?.pbs[key].time} 
                        onChange={e => setEditForm({...editForm!, pbs: {...editForm!.pbs, [key]: {...editForm!.pbs[key], time: e.target.value}}})} 
                        className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-black text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-10 focus:outline-none transition-all bg-gray-50/50" 
                      />
                    </div>
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-gray-600 uppercase ml-1">Date</span>
                      <input 
                        type="date" 
                        value={editForm?.pbs[key].date} 
                        onChange={e => setEditForm({...editForm!, pbs: {...editForm!.pbs, [key]: {...editForm!.pbs[key], date: e.target.value}}})} 
                        className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-black text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-10 focus:outline-none transition-all bg-gray-50/50" 
                      />
                    </div>
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Goal Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative group flex flex-col justify-between">
        <button 
          onClick={() => setIsEditing(true)} 
          className="absolute top-4 right-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <div>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Current Goals</p>
          <div className="space-y-2">
            {stats.goals.map((goal, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0"></div>
                <p className="text-sm font-black text-gray-800 leading-tight">{goal}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center relative flex flex-col justify-center">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-2">Training Status</p>
        <Link 
          href="/status"
          className={`inline-block px-4 py-1 rounded-full text-sm font-black uppercase tracking-tighter transition-all hover:scale-105 active:scale-95 ${
            stats.status === 'Productive' ? 'bg-green-100 text-green-700 hover:bg-green-200' :
            stats.status === 'Peaking' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
            stats.status === 'Maintenance' ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' :
            'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {stats.status}
        </Link>
      </div>

      {/* Last Race Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-center">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Last Race</p>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-xl font-black text-gray-900 leading-none">{stats.lastRace?.distance}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">{stats.lastRace?.date || 'No date'}</p>
          </div>
          <p className="text-lg font-bold text-purple-600">{stats.lastRace?.time}</p>
        </div>
      </div>

      {/* PBs Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Current PBs</p>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400">5K</span>
            <span className="text-sm font-black text-gray-800">{stats.pbs['5k'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400">10K</span>
            <span className="text-sm font-black text-gray-800">{stats.pbs['10k'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400">Half</span>
            <span className="text-sm font-black text-gray-800">{stats.pbs['Half'].time}</span>
          </div>
          <div className="flex justify-between items-center border-b border-gray-50 pb-1">
            <span className="text-[10px] font-bold text-gray-400">Full</span>
            <span className="text-sm font-black text-gray-800">{stats.pbs['Marathon'].time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
