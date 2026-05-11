'use client';

import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Run } from '@/types/run';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

export default function RunDetail() {
  const params = useParams();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRun = async () => {
      if (!params.id) return;
      try {
        const docRef = doc(db, 'runs', params.id as string);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRun({ id: docSnap.id, ...docSnap.data() } as Run);
        }
      } catch (error) {
        console.error("Error fetching run details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRun();
  }, [params.id]);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading run details...</div>;
  if (!run) return <div className="text-center py-20 text-red-500">Run not found.</div>;

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <button 
          onClick={() => router.back()}
          className="mb-6 flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          ← Back to Dashboard
        </button>

        <div className="bg-white shadow-xl rounded-2xl overflow-hidden mb-8">
          <div className={`p-8 text-white ${
            run.runType === 'Easy' ? 'bg-green-600' :
            run.runType === 'Long Run' ? 'bg-blue-600' :
            run.runType === 'Tempo' ? 'bg-purple-600' :
            run.runType === 'Interval' ? 'bg-orange-500' :
            run.runType === 'Race' ? 'bg-red-800' :
            'bg-gray-600'
          }`}>
            <div className="flex justify-between items-center">
              <div>
                <span className="text-sm font-bold uppercase tracking-widest opacity-80">{run.runType} Run</span>
                <h1 className="text-4xl font-black mt-1">{run.distance} km</h1>
              </div>
              <div className="text-right">
                <p className="text-xl font-medium opacity-90">{run.date}</p>
                <p className="text-sm opacity-75 mt-1">{run.duration} total time</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Avg Pace</p>
                <p className="text-2xl font-black text-gray-900">{run.averagePace}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Avg HR</p>
                <p className="text-2xl font-black text-red-600">{run.averageHeartRate}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Cadence</p>
                <p className="text-2xl font-black text-blue-600">{run.averageCadence}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Calories</p>
                <p className="text-2xl font-black text-orange-600">{run.calories}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Ascent</p>
                <p className="text-2xl font-black text-green-600">{run.ascent}m</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl text-center">
                <p className="text-gray-600 text-xs uppercase font-bold mb-1">Descent</p>
                <p className="text-2xl font-black text-green-700">{run.descent}m</p>
              </div>
              {run.location && (
                <div className="bg-gray-50 p-4 rounded-xl text-center">
                  <p className="text-gray-600 text-xs uppercase font-bold mb-1">Location</p>
                  <p className="text-xl font-black text-gray-900 truncate">{run.location}</p>
                </div>
              )}
              {run.weather && (
                <div className="bg-gray-50 p-4 rounded-xl text-center">
                  <p className="text-gray-600 text-xs uppercase font-bold mb-1">Weather</p>
                  <p className="text-sm font-bold text-gray-900">{run.weather}</p>
                </div>
              )}
            </div>

            {run.summary && (
              <div className="mb-10">
                <h2 className="text-lg font-bold text-gray-800 mb-3 uppercase tracking-tight">Jules&apos; Notes</h2>
                <div className="bg-blue-50 p-6 rounded-xl text-gray-700 italic border-l-4 border-blue-400 text-lg shadow-sm">
                  &ldquo;{run.summary}&rdquo;
                </div>
              </div>
            )}

            {run.coachReview && (
              <div className="mb-10">
                <h2 className="text-lg font-bold text-gray-800 mb-3 uppercase tracking-tight flex items-center gap-2">
                  <span className="bg-blue-600 text-white text-[10px] px-2 py-1 rounded-md">AI</span>
                  Coach Review
                </h2>
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-6 rounded-2xl text-gray-100 shadow-xl border-l-4 border-blue-500">
                  <div className="text-lg leading-relaxed font-medium italic">
                    <ReactMarkdown
                      components={{
                        ul: ({node, ...props}) => <ul className="list-disc ml-6 mb-4 space-y-2" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal ml-6 mb-4 space-y-2" {...props} />,
                        li: ({node, ...props}) => <li className="pl-1" {...props} />,
                        p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                      }}
                    >
                      {run.coachReview}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {run.laps && run.laps.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-gray-800 mb-4 uppercase tracking-tight">Laps</h2>
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Lap</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Distance</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Pace</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Avg HR</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Cadence</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {run.laps.map((lap) => (
                        <tr key={lap.lapNumber} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-900">{lap.lapNumber}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{lap.distance} km</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{lap.time}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{lap.avgPace}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{lap.avgHR} bpm</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{lap.avgCadence} spm</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-black">
                      <tr>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 uppercase">Total</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{run.distance} km</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{run.duration}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">{run.averagePace}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-red-600">{run.averageHeartRate} bpm</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600">{run.averageCadence} spm</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
