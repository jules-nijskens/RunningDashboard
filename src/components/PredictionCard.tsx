'use client';

import React, { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

interface PredictionData {
  currentEstimate: string;
  probability: number;
  coachComment: string;
  detailedReasoning?: string;
  lastUpdated?: string;
}

export default function PredictionCard() {
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPrediction() {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/prediction', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          setPrediction(data);
        }
      } catch (err) {
        console.error("Failed to fetch prediction:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchPrediction();
  }, []);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-pulse h-48 mb-8">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-6"></div>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="h-10 bg-gray-100 rounded"></div>
          <div className="h-10 bg-gray-100 rounded"></div>
        </div>
        <div className="h-4 bg-gray-100 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-100 rounded w-2/3"></div>
      </div>
    );
  }

  if (!prediction) return null;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden group mb-8">
      <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
        <span className="text-8xl font-black">🏁</span>
      </div>
      
      <div className="relative z-10">
        <div className="flex justify-between items-center mb-6">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
            AI Race Predictor
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          </p>
          <div className="px-3 py-1 bg-blue-50 rounded-full">
            <p className="text-[10px] font-black text-blue-600 uppercase">Target: Sub-47:30</p>
          </div>
        </div>

        {prediction.lastUpdated && (
          <p className="text-[9px] font-bold text-gray-300 uppercase mb-4">
            Last Updated: {new Date(prediction.lastUpdated).toLocaleString()}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="flex items-end gap-4">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Current 10K Fitness</p>
              <p className="text-5xl font-black text-gray-900 tracking-tighter">
                {prediction.currentEstimate}
              </p>
            </div>
            <div className="mb-1">
              <span className="text-xs font-bold text-gray-400 uppercase">Est. Time</span>
            </div>
          </div>
          
          <div className="flex flex-col md:items-end">
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-black text-gray-900">{prediction.probability}%</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Probability</p>
            </div>
            {/* Progress Bar */}
            <div className="mt-2 h-2 w-full md:w-48 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ease-out ${
                  prediction.probability > 75 ? 'bg-green-500' : 
                  prediction.probability > 50 ? 'bg-blue-500' : 
                  prediction.probability > 30 ? 'bg-orange-500' : 'bg-red-500'
                }`}
                style={{ width: `${prediction.probability}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 flex gap-4 items-start">
          <span className="text-2xl mt-1">🧠</span>
          <div>
            <p className="text-[10px] font-black text-blue-600 uppercase mb-1 tracking-wider">Coach's Insight</p>
            <p className="text-base font-bold text-gray-800 leading-snug">
              {prediction.coachComment}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
