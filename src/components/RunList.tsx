'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Run } from '@/types/run';
import { useRouter } from 'next/navigation';

export default function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<8 | 30 | 'all'>(8);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  useEffect(() => {
    // Reset to page 1 if page size changes
    setCurrentPage(1);
  }, [pageSize]);

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

  const actualPageSize = pageSize === 'all' ? runs.length : pageSize;
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(runs.length / actualPageSize);
  const currentRuns = pageSize === 'all' ? runs : runs.slice((currentPage - 1) * actualPageSize, currentPage * actualPageSize);

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
    return (
      <div className="text-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Loading Past Runs...</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="bg-white p-8 rounded-xl shadow-md border border-gray-100 text-center">
        <p className="text-gray-700 font-medium italic">No runs uploaded yet. Start by uploading a Garmin CSV!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Activity History</h2>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Total Activities: {runs.length}</p>
        </div>
        
        <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-xl border border-gray-200">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Show:</span>
          {[8, 30, 'all'].map((size) => (
            <button
              key={size}
              onClick={() => setPageSize(size as any)}
              className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all ${
                pageSize === size 
                  ? 'bg-white text-blue-600 shadow-sm border border-gray-200' 
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {size === 'all' ? 'All' : size}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Distance</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Pace</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Duration</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Avg HR</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Cadence</th>
                <th className="px-6 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest">Coach Review</th>
                <th className="px-6 py-4 text-right text-[10px] font-black text-gray-500 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {currentRuns.map((run) => (
                <tr 
                  key={run.id} 
                  onClick={() => run.id && handleRowClick(run.id)}
                  className="hover:bg-blue-50/50 cursor-pointer transition-colors group/row"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
                    {run.timestamp 
                      ? new Date(run.timestamp).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '')
                      : run.date}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-3 py-1 inline-flex text-[10px] font-black uppercase rounded-full ${
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
                      <span>💡 Review</span>
                    </div>
                    {run.coachReviewShort && (
                      <div className="invisible group-hover/insight:visible absolute z-[100] bottom-full right-0 mb-3 w-64 p-5 bg-gray-900 text-white text-[11px] rounded-2xl shadow-2xl border border-gray-800 pointer-events-none transition-all opacity-0 group-hover/insight:opacity-100 transform translate-y-1 group-hover/insight:translate-y-0 leading-relaxed font-medium">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-800">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                          <p className="font-black text-blue-400 uppercase tracking-widest text-[9px]">Coach Insight</p>
                        </div>
                        <p className="italic text-gray-200">&quot;{run.coachReviewShort}&quot;</p>
                        <div className="absolute top-full right-6 border-8 border-transparent border-t-gray-900"></div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={(e) => run.id && handleDelete(e, run.id)}
                      className="text-red-400 hover:text-red-600 p-2 rounded-lg transition-colors opacity-0 group-hover/row:opacity-100"
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

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={`p-2 rounded-lg border transition-all ${
                  currentPage === 1 
                    ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed' 
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = currentPage;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-[10px] font-black transition-all ${
                        currentPage === pageNum
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-gray-500 border border-gray-200 hover:border-blue-200 hover:text-blue-500'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className={`p-2 rounded-lg border transition-all ${
                  currentPage === totalPages 
                    ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed' 
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
