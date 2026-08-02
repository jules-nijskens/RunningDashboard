'use client';

import React, { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, Loader2, Settings, ShieldCheck, HelpCircle } from 'lucide-react';

export default function SettingsPage() {
  const [coachingMode, setCoachingMode] = useState<'runna' | 'gemini'>('runna');
  const [trainingMode, setTrainingMode] = useState<'race' | 'building'>('race');
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [savingField, setSavingField] = useState<'coaching' | 'training' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCoachingMode(data.coachingMode || 'runna');
        setTrainingMode(data.trainingMode || 'race');
      }
      setLoading(false);
    }, (err) => {
      console.error("Settings: Failed to listen to user_stats:", err);
      setError("Failed to load settings from database.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleUpdateCoachingMode = async (mode: 'runna' | 'gemini') => {
    if (savingField || recalculating) return;
    setSavingField('coaching');
    setError(null);
    try {
      await updateDoc(doc(db, 'settings', 'user_stats'), {
        coachingMode: mode
      });
    } catch (err: any) {
      console.error("Settings: Failed to update coaching mode:", err);
      setError("Failed to save coaching preference.");
    } finally {
      setSavingField(null);
    }
  };

  const handleUpdateTrainingMode = async (mode: 'race' | 'building') => {
    if (savingField || recalculating) return;
    setSavingField('training');
    setRecalculating(true);
    setError(null);
    try {
      // 1. Update user_stats in Firestore
      await updateDoc(doc(db, 'settings', 'user_stats'), {
        trainingMode: mode
      });

      // 2. Trigger AI Prediction calculation rebuild in background
      console.log("Settings: Triggering prediction refresh...");
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error("No authentication token available.");
      }

      const res = await fetch('/api/prediction', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        throw new Error(`Failed to recalculate prediction: ${res.statusText}`);
      }
      console.log("Settings: Prediction recalculation successful.");
    } catch (err: any) {
      console.error("Settings: Failed to update training mode/recalculate:", err);
      setError(`Failed to switch mode: ${err.message || err}`);
    } finally {
      setSavingField(null);
      setRecalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center font-black uppercase tracking-widest text-gray-600">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        Loading Settings...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8 text-gray-900">
      <div className="max-w-xl mx-auto">
        
        {/* Navigation Header */}
        <div className="flex justify-between items-center mb-5">
          <Link 
            href="/" 
            className="inline-flex items-center text-xs font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest group"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5 transform group-hover:-translate-x-0.5 transition-transform" />
            Dashboard
          </Link>
        </div>

        {/* Settings Card container */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          
          {/* Cover Header */}
          <div className="bg-gray-900 p-6 text-white relative">
            <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600 rounded-full blur-[100px] opacity-20 -mr-24 -mt-24"></div>
            <p className="text-[9px] font-black text-blue-400 uppercase tracking-[0.3em] mb-2">Configuration Panel</p>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <Settings className="w-6 h-6 text-blue-500" />
              Settings
            </h1>
            <p className="text-gray-400 mt-1 font-bold uppercase text-[9px] tracking-widest">
              Manage your AI coaching preferences and training focus modes.
            </p>
          </div>

          <div className="p-6 space-y-8">
            
            {error && (
              <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-700">
                ⚠️ Error: {error}
              </div>
            )}

            {recalculating && (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3 text-blue-800 shadow-sm animate-pulse">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600 shrink-0" />
                <div>
                  <p className="text-xs font-black uppercase tracking-wider">Recalculating AI Metrics...</p>
                  <p className="text-[10px] font-medium text-blue-600">The coach is computing your rolling Aerobic Efficiency and updating target predictions. This takes a few seconds.</p>
                </div>
              </div>
            )}

            {/* SECTION 1: COACHING MODE */}
            <div className="space-y-3">
              <div className="flex justify-between items-baseline border-b border-gray-100 pb-1.5">
                <h3 className="text-xs font-black uppercase text-gray-900 tracking-wider">Coaching Preferences</h3>
                {savingField === 'coaching' && (
                  <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Saving...
                  </span>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                
                {/* Runna Card */}
                <div 
                  onClick={() => handleUpdateCoachingMode('runna')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between hover:shadow-sm relative overflow-hidden ${
                    coachingMode === 'runna' 
                      ? 'border-orange-500 bg-orange-50/10' 
                      : 'border-gray-100 hover:border-gray-200 bg-white'
                  }`}
                >
                  {coachingMode === 'runna' && (
                    <div className="absolute top-3 right-3 bg-orange-500 text-white rounded-full p-0.5 shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-orange-600 mb-1">Runna Coach</h4>
                    <p className="text-[10px] text-gray-400 font-medium leading-relaxed">
                      Syncs structured, high-intensity training schedules directly from your Runna application settings. Focuses on race-pace targets.
                    </p>
                  </div>
                </div>

                {/* Gemini AI Card */}
                <div 
                  onClick={() => handleUpdateCoachingMode('gemini')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between hover:shadow-sm relative overflow-hidden ${
                    coachingMode === 'gemini' 
                      ? 'border-orange-500 bg-orange-50/10' 
                      : 'border-gray-100 hover:border-gray-200 bg-white'
                  }`}
                >
                  {coachingMode === 'gemini' && (
                    <div className="absolute top-3 right-3 bg-orange-500 text-white rounded-full p-0.5 shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-orange-600 mb-1">Gemini AI Coach</h4>
                    <p className="text-[10px] text-gray-400 font-medium leading-relaxed">
                      Enables the bespoke AI Running Coach model to directly generate pacing guides, review training load history, and adapt recommendations.
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* SECTION 2: TRAINING FOCUS MODE */}
            <div className="space-y-3 pt-3 border-t border-gray-100">
              <div className="flex justify-between items-baseline border-b border-gray-100 pb-1.5">
                <h3 className="text-xs font-black uppercase text-gray-900 tracking-wider">Training Focus Mode</h3>
                {savingField === 'training' && (
                  <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Saving...
                  </span>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                
                {/* Race Mode Card */}
                <div 
                  onClick={() => handleUpdateTrainingMode('race')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between hover:shadow-sm relative overflow-hidden ${
                    trainingMode === 'race' 
                      ? 'border-blue-600 bg-blue-50/5' 
                      : 'border-gray-100 hover:border-gray-200 bg-white'
                  }`}
                >
                  {trainingMode === 'race' && (
                    <div className="absolute top-3 right-3 bg-blue-600 text-white rounded-full p-0.5 shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 mb-1">🏆 Race Mode</h4>
                    <p className="text-[10px] text-gray-400 font-medium leading-relaxed">
                      Predicts finish times for your upcoming races. Displays **target split schedules**, paces, and success probability percentages. Best used during active race training blocks.
                    </p>
                  </div>
                </div>

                {/* Building Mode Card */}
                <div 
                  onClick={() => handleUpdateTrainingMode('building')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between hover:shadow-sm relative overflow-hidden ${
                    trainingMode === 'building' 
                      ? 'border-blue-600 bg-blue-50/5' 
                      : 'border-gray-100 hover:border-gray-200 bg-white'
                  }`}
                >
                  {trainingMode === 'building' && (
                    <div className="absolute top-3 right-3 bg-blue-600 text-white rounded-full p-0.5 shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 mb-1">🏃‍♂️ Building Mode</h4>
                    <p className="text-[10px] text-gray-400 font-medium leading-relaxed">
                      Tracks rolling **Aerobic Efficiency (EF)** and Pace-to-Heart-Rate ratios. Filters out watch-stopping tails. Analyzes autonomic recovery (HRV) and volume capacity. Best used between races.
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Help box */}
            <div className="p-4 bg-gray-50 rounded-xl flex gap-3 border border-gray-100">
              <HelpCircle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <div className="text-[10px] text-gray-400 leading-relaxed font-medium">
                <strong className="text-gray-500 block mb-0.5">About Aerobic Efficiency (EF)</strong>
                The Efficiency Factor represents your running speed in meters per minute divided by average heart rate. A higher EF means you run faster for the same metabolic cost. By filtering out walks and short watch-stopping tails, this monitor keeps track of your exact aerobic conditioning.
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
