'use client';

import React, { useState } from 'react';
import RunList from '@/components/RunList';
import PlannedRuns from '@/components/PlannedRuns';
import WorkoutList from '@/components/WorkoutList';
import UserStats from '@/components/UserStats';
import WeeklyStats from '@/components/WeeklyStats';
import PredictionCard from '@/components/PredictionCard';
import GeminiCoach from '@/components/GeminiCoach';
import ChatHistory from '@/components/ChatHistory';
import Link from 'next/link';

type TabType = 'planned-runs' | 'runs' | 'workouts' | 'coach';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('planned-runs');

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
              RunningDashboard
            </h1>
            <p className="mt-3 text-lg text-gray-700">
              Track your progress and analyze your Garmin runs.
            </p>
          </div>
          <Link 
            href="/upload"
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
          >
            Upload New Run
          </Link>
        </header>

        <UserStats />
        <WeeklyStats />
        <PredictionCard />

        <div className="mt-12">
          <div className="border-b border-gray-200 mb-8">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('planned-runs')}
                className={`
                  py-4 px-1 border-b-2 font-black text-sm uppercase tracking-widest transition-all
                  ${activeTab === 'planned-runs'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                `}
              >
                📅 Planned Runs
              </button>
              <button
                onClick={() => setActiveTab('runs')}
                className={`
                  py-4 px-1 border-b-2 font-black text-sm uppercase tracking-widest transition-all
                  ${activeTab === 'runs'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                `}
              >
                🏃‍♂️ Runs
              </button>
              <button
                onClick={() => setActiveTab('workouts')}
                className={`
                  py-4 px-1 border-b-2 font-black text-sm uppercase tracking-widest transition-all
                  ${activeTab === 'workouts'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                `}
              >
                🏋️‍♂️ Gym Workouts
              </button>
              <button
                onClick={() => setActiveTab('coach')}
                className={`
                  py-4 px-1 border-b-2 font-black text-sm uppercase tracking-widest transition-all
                  ${activeTab === 'coach'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                `}
              >
                🧠 Coach Logs
              </button>
            </nav>
          </div>

          <div className="transition-all duration-300">
            {activeTab === 'planned-runs' ? (
              <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <PlannedRuns />
              </section>
            ) : activeTab === 'runs' ? (
              <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <RunList />
              </section>
            ) : activeTab === 'workouts' ? (
              <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <WorkoutList />
              </section>
            ) : (
              <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <ChatHistory />
              </section>
            )}
          </div>
        </div>
      </div>
      
      <GeminiCoach />
    </main>
  );
}
