'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Run } from '@/types/run';
import { useRouter } from 'next/navigation';

export default function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const q = query(collection(db, 'runs'), orderBy('timestamp', 'desc'));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const runsData: Run[] = [];
      querySnapshot.forEach((doc) => {
        runsData.push({ id: doc.id, ...doc.data() } as Run);
      });
      setRuns(runsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching runs:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleRowClick = (id: string) => {
    router.push(`/runs/${id}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent row click navigation
    if (window.confirm('Are you sure you want to delete this activity?')) {
      try {
        await deleteDoc(doc(db, 'runs', id));
      } catch (error) {
        console.error("Error deleting run:", error);
        alert("Failed to delete activity.");
      }
    }
  };

  if (loading) {
    return <div className="text-center py-10">Loading your runs...</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="bg-white p-8 rounded-lg shadow-md text-center">
        <p className="text-gray-700">No runs uploaded yet. Start by uploading a Garmin CSV!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Your Runs</h2>
        <span className="text-xs text-gray-600 font-medium italic">Click a row to see details</span>
      </div>
      <div className="bg-white shadow-md rounded-xl border border-gray-100">
        <div className="overflow-visible">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider rounded-tl-xl">Date</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Distance</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Pace</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Avg HR</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Cadence</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Coach Insight</th>
                <th className="px-6 py-3 text-right text-xs font-black text-gray-700 uppercase tracking-wider rounded-tr-xl">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {runs.map((run) => (
                <tr 
                  key={run.id} 
                  onClick={() => run.id && handleRowClick(run.id)}
                  className="hover:bg-blue-50/50 cursor-pointer transition-all group/row relative"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
                    {run.timestamp 
                      ? new Date(run.timestamp).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '')
                      : run.date}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-3 py-1 inline-flex text-[10px] leading-5 font-black uppercase rounded-full ${
                      run.runType === 'Easy' ? 'bg-green-100 text-green-700' :
                      run.runType === 'Long Run' ? 'bg-blue-100 text-blue-700' :
                      run.runType === 'Tempo' ? 'bg-purple-100 text-purple-700' :
                      run.runType === 'Interval' ? 'bg-orange-100 text-orange-700' :
                      run.runType === 'Race' ? 'bg-red-200 text-red-900 border border-red-300' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {run.runType}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-black">{run.distance} km</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">{run.averagePace} /km</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">{run.duration}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">{run.averageHeartRate} bpm</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">{run.averageCadence} spm</td>
                  <td className="px-6 py-4 text-sm relative group/insight">
                    <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1 rounded-full w-fit font-black text-[10px] uppercase tracking-widest transition-all group-hover/insight:bg-blue-600 group-hover/insight:text-white cursor-help">
                      <span>💡 Insight</span>
                    </div>
                    {run.coachReviewShort && (
                      <div className="invisible group-hover/insight:visible absolute z-[100] bottom-full right-0 mb-3 w-64 p-4 bg-gray-900 text-white text-[11px] rounded-xl shadow-2xl border border-gray-800 pointer-events-none transition-all opacity-0 group-hover/insight:opacity-100 transform translate-y-1 group-hover/insight:translate-y-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                          <p className="font-black text-blue-400 uppercase tracking-widest text-[9px]">Coach Quick Tip</p>
                        </div>
                        <p className="leading-relaxed font-bold italic text-gray-100">&quot;{run.coachReviewShort}&quot;</p>
                        <div className="absolute top-full right-6 border-8 border-transparent border-t-gray-900"></div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={(e) => run.id && handleDelete(e, run.id)}
                      className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors"
                      title="Delete activity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
