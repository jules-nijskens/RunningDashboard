'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { db, workoutsDb } from '@/lib/firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';
import { Activity, Calendar, Trophy } from 'lucide-react';

interface WeeklyData {
  weekStart: string;
  completedDistance: number;
  plannedDistance: number;
  workouts: number;
}

export default function WeeklyStats() {
  const [data, setData] = useState<WeeklyData[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to get YYYY-MM-DD in local time
  const getLocalYYYYMMDD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Get Completed Runs
        const runsSnap = await getDocs(query(collection(db, 'runs'), orderBy('timestamp', 'asc')));
        const runs = runsSnap.docs.map(doc => doc.data());

        // 2. Get Workouts
        let workouts: any[] = [];
        if (workoutsDb) {
          const workoutsSnap = await getDocs(query(collection(workoutsDb, 'workouts'), orderBy('date', 'asc')));
          workouts = workoutsSnap.docs.map(doc => doc.data());
        }

        // 3. Get Planned Runs (Google Calendar)
        const token = sessionStorage.getItem('google_calendar_token');
        const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;
        let plannedEvents: any[] = [];
        if (token && calendarId) {
          const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // Last 30 days
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=50`;
          const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
          if (res.ok) {
            const json = await res.json();
            plannedEvents = json.items || [];
          }
        }

        // Grouping logic (Week starts on Monday)
        const weeklyMap: { [key: string]: WeeklyData } = {};

        const getMonday = (date: Date) => {
          const d = new Date(date);
          const day = d.getDay();
          // Adjust for Sunday (0) being the end of the week in this context
          const diff = d.getDate() - (day === 0 ? 6 : day - 1);
          const monday = new Date(d.setDate(diff));
          monday.setHours(0, 0, 0, 0);
          return getLocalYYYYMMDD(monday);
        };

        // Process Runs
        runs.forEach(run => {
          const monday = getMonday(new Date(run.timestamp));
          if (!weeklyMap[monday]) weeklyMap[monday] = { weekStart: monday, completedDistance: 0, plannedDistance: 0, workouts: 0 };
          weeklyMap[monday].completedDistance += run.distance || 0;
        });

        // Process Workouts
        workouts.forEach(w => {
          const date = w.date?.toDate ? w.date.toDate() : new Date(w.date);
          const monday = getMonday(date);
          if (!weeklyMap[monday]) weeklyMap[monday] = { weekStart: monday, completedDistance: 0, plannedDistance: 0, workouts: 0 };
          weeklyMap[monday].workouts += 1;
        });

        // Process Planned
        plannedEvents.forEach(e => {
          const dateStr = e.start.dateTime || e.start.date;
          const monday = getMonday(new Date(dateStr));
          
          // Try to extract distance from summary (e.g., "10.5 km")
          const distMatch = e.summary.match(/(\d+[.,]?\d*)\s*km/i);
          const dist = distMatch ? parseFloat(distMatch[1].replace(',', '.')) : 0;

          if (!weeklyMap[monday]) weeklyMap[monday] = { weekStart: monday, completedDistance: 0, plannedDistance: 0, workouts: 0 };
          
          // Only add to planned if it's in the future (or today)
          if (new Date(dateStr) >= new Date()) {
            weeklyMap[monday].plannedDistance += dist;
          }
        });

        // Convert to array and sort
        const sortedData = Object.values(weeklyMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
        
        // Window Logic: Exactly 8 weeks history + 4 weeks outlook (including current)
        const today = new Date();
        const currentMondayStr = getMonday(today);
        
        // Calculate 8 weeks ago
        const currentMonday = new Date(currentMondayStr + 'T00:00:00');
        const eightWeeksAgo = new Date(currentMonday);
        eightWeeksAgo.setDate(eightWeeksAgo.getDate() - (7 * 8));
        
        // Calculate 3 weeks forward (for a total of 4 weeks including current)
        const threeWeeksForward = new Date(currentMonday);
        threeWeeksForward.setDate(threeWeeksForward.getDate() + (7 * 3));
        
        // Filter and ensure we have all weeks in the range (even if empty)
        const finalData: (WeeklyData & { labelHeight: number })[] = [];
        let iterDate = new Date(eightWeeksAgo);
        
        while (iterDate <= threeWeeksForward) {
          const iterStr = getLocalYYYYMMDD(iterDate);
          const existing = sortedData.find(d => d.weekStart === iterStr);
          
          const completed = existing?.completedDistance || 0;
          const planned = existing?.plannedDistance || 0;
          const workouts = existing?.workouts || 0;

          finalData.push({
            weekStart: iterStr,
            completedDistance: completed,
            plannedDistance: planned,
            workouts: workouts,
            labelHeight: 0.1, // Small height for ghost bar in stack
          } as any);
          
          iterDate.setDate(iterDate.getDate() + 7);
        }
        
        setData(finalData as any);
      } catch (err) {
        console.error("Failed to fetch weekly stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return null;

  // Find the current week's data for the stat cards
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - (day === 0 ? 6 : day - 1);
  const thisMonday = new Date(today.setDate(diff));
  thisMonday.setHours(0, 0, 0, 0);
  const thisMondayStr = getLocalYYYYMMDD(thisMonday);
  const currentWeek = data.find(d => d.weekStart === thisMondayStr) || data[data.length - 1];

  return (
    <div className="bg-white p-6 rounded-3xl shadow-lg border border-gray-100 mb-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
            <Activity className="text-blue-600 w-5 h-5" />
            Training Volume & Outlook
          </h2>
          <p className="text-gray-500 font-bold text-[10px] uppercase tracking-[0.2em] mt-0.5">8 Weeks History + 4 Weeks Forecast</p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-blue-600 rounded-full"></div>
            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Done</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-gray-400 rounded-full"></div>
            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Plan</span>
          </div>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
            <XAxis 
              dataKey="weekStart" 
              tickFormatter={(str) => {
                if (str === thisMondayStr) return 'THIS WK';
                const date = new Date(str + 'T00:00:00');
                return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
              }}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 8, fontWeight: '900', fill: '#9ca3af' }}
              dy={10}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fontWeight: 'bold', fill: '#9ca3af' }}
            />
            <Tooltip 
              cursor={{ fill: '#f9fafb' }}
              contentStyle={{ 
                borderRadius: '12px', 
                border: 'none', 
                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                padding: '12px'
              }}
              labelStyle={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '10px', marginBottom: '4px', color: '#111827' }}
              labelFormatter={(label) => `Week of ${new Date(label + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long' })}`}
            />
            <Bar 
              dataKey="completedDistance" 
              stackId="a" 
              fill="#2563eb" 
              radius={[0, 0, 0, 0]} 
              barSize={24}
              name="Done"
            />
            <Bar 
              dataKey="plannedDistance" 
              stackId="a" 
              fill="#94a3b8" 
              radius={[4, 4, 0, 0]} 
              barSize={24}
              name="Planned"
            />
            {/* Transparent bar at top of stack for workout labels */}
            <Bar 
              dataKey="labelHeight" 
              stackId="a" 
              fill="transparent" 
              barSize={24}
              isAnimationActive={false}
            >
              <LabelList 
                dataKey="workouts" 
                position="top" 
                style={{ fill: '#f97316', fontSize: 14, fontWeight: '900' }} 
                formatter={(val: any) => val > 0 ? val : ''}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
        {currentWeek && (
          <>
            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100/50">
              <p className="text-[9px] font-black text-blue-800 uppercase tracking-widest mb-0.5">Ran This Week</p>
              <p className="text-xl font-black text-blue-900">{currentWeek.completedDistance.toFixed(1)} <span className="text-xs">km</span></p>
            </div>
            <div className="bg-gray-50/50 p-3 rounded-xl border border-gray-200/50">
              <p className="text-[9px] font-black text-gray-700 uppercase tracking-widest mb-0.5">Remaining</p>
              <p className="text-xl font-black text-gray-900">{currentWeek.plannedDistance.toFixed(1)} <span className="text-xs">km</span></p>
            </div>
            <div className="bg-orange-50/50 p-3 rounded-xl border border-orange-100/50">
              <p className="text-[9px] font-black text-orange-800 uppercase tracking-widest mb-0.5">Gym Sessions</p>
              <p className="text-xl font-black text-orange-900">{currentWeek.workouts}</p>
            </div>
            <div className="bg-green-50/50 p-3 rounded-xl border border-green-100/50">
              <p className="text-[9px] font-black text-green-800 uppercase tracking-widest mb-0.5">Weekly Goal</p>
              <p className="text-lg font-black text-green-900 uppercase">{(currentWeek.completedDistance + currentWeek.plannedDistance).toFixed(1)} km</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}