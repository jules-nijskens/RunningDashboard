'use client';

import React, { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Workout } from '@/types/run';

type WorkoutLocation = 'office' | 'home';

export default function WorkoutList() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLocation, setActiveLocation] = useState<WorkoutLocation>('office');

  const fetchWorkouts = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const response = await fetch('/api/workouts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setWorkouts(data.workouts || []);
      }
    } catch (error) {
      console.error("Error fetching workouts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkouts();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this workout?')) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/workouts?id=${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          setWorkouts(workouts.filter(w => w.id !== id));
        } else {
          throw new Error("Failed to delete");
        }
      } catch (error) {
        console.error("Error deleting workout:", error);
        alert("Failed to delete workout.");
      }
    }
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString();
  };

  if (loading) {
    return <div className="text-center py-10">Loading your workouts...</div>;
  }

  const filteredWorkouts = workouts.filter(w => w.type === activeLocation);

  // Get all unique exercise keys from filtered workouts to build the table header
  const exerciseKeys = Array.from(new Set(
    filteredWorkouts.flatMap(w => 
      Object.keys(w).filter(k => !['id', 'date', 'type'].includes(k))
    )
  ));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Gym Workouts</h2>
        
        <div className="flex p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => setActiveLocation('office')}
            className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md transition-all ${
              activeLocation === 'office' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            🏢 Office
          </button>
          <button
            onClick={() => setActiveLocation('home')}
            className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md transition-all ${
              activeLocation === 'home' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            🏠 Home
          </button>
        </div>
      </div>

      {filteredWorkouts.length === 0 ? (
        <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-100 text-center">
          <p className="text-gray-400 font-medium">No {activeLocation} workouts recorded yet.</p>
        </div>
      ) : (
        <div className="bg-white shadow-md rounded-xl border border-gray-100 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider rounded-tl-xl">Date</th>
                {exerciseKeys.map(key => (
                  <th key={key} className="px-6 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </th>
                ))}
                <th className="px-6 py-3 text-right text-xs font-black text-gray-500 uppercase tracking-wider rounded-tr-xl">Actions</th>
                </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                {filteredWorkouts.map((workout) => (
                <tr key={workout.id} className="hover:bg-blue-50/50 transition-all">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
                    {formatDate(workout.date)}
                  </td>
                  {exerciseKeys.map(key => {
                    const exercise = workout[key];
                    return (
                      <td key={key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">
                        {exercise ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-900">{exercise.weight}kg</span>
                            <span className="text-[10px]">{exercise.times}</span>
                            <span className={`text-[10px] font-black uppercase ${
                              exercise.rating === 'Hard' ? 'text-red-500' : 
                              exercise.rating === 'Normal' ? 'text-blue-500' : 'text-green-500'
                            }`}>{exercise.rating}</span>
                          </div>
                        ) : '-'}
                      </td>
                    );
                  })}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={(e) => workout.id && handleDelete(e, workout.id)}
                      className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors"
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
      )}
    </div>
  );
}
