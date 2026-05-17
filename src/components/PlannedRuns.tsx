'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import ReactMarkdown from 'react-markdown';

interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  description?: string;
}

interface WorkoutItem {
  id: string;
  workoutName: string;
  distance: string;
  runType: string;
  description: string;
  date: string;
}

interface WeatherData {
  [date: string]: {
    temp: number;
    emoji: string;
    windSpeed: number;
  };
}

const getWeatherEmoji = (code: number) => {
  if (code === 0) return '☀️';
  if (code <= 3) return '🌤️';
  if (code <= 48) return '☁️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⛈️';
  return '🌡️';
};

export default function PlannedRuns() {
  const [items, setItems] = useState<WorkoutItem[]>([]);
  const [coachingMode, setCoachingMode] = useState<'runna' | 'gemini'>('runna');
  const [hasRunToday, setHasRunToday] = useState(false);
  const [weather, setWeather] = useState<WeatherData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        setCoachingMode(docSnap.data().coachingMode || 'runna');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const checkTodayRun = async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const q = query(
          collection(db, 'runs'),
          where('timestamp', '>=', today.getTime()),
          where('timestamp', '<', tomorrow.getTime())
        );
        const snapshot = await getDocs(q);
        setHasRunToday(!snapshot.empty);
      } catch (err) {
        console.error("Error checking today's run:", err);
      }
    };
    checkTodayRun();
  }, []);

  useEffect(() => {
    const fetchPlannedRunsAndWeather = async () => {
      setLoading(true);
      setError(null);

      try {
        let fetchedItems: WorkoutItem[] = [];

        if (coachingMode === 'runna') {
          const token = sessionStorage.getItem('google_calendar_token');
          const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;

          if (!token) {
            setError('No calendar access token found. Please sign in again.');
            setLoading(false);
            return;
          }

          if (!calendarId) {
            setError('Training Calendar ID not configured.');
            setLoading(false);
            return;
          }

          const timeMin = new Date().toISOString();
          const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=10`;
          
          const response = await fetch(calendarUrl, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) throw new Error('Calendar session expired.');
            throw new Error(`Calendar API error: ${errorData.error?.message || 'Failed to fetch'}`);
          }

          const data = await response.json();
          const events: CalendarEvent[] = data.items || [];
          fetchedItems = events.map(event => {
            const { workoutName, distance, runType, description } = parseRunnaEvent(event);
            return {
              id: event.id,
              workoutName,
              distance,
              runType,
              description,
              date: event.start.dateTime || event.start.date || ''
            };
          });
        } else {
          // Gemini Mode
          const token = await auth.currentUser?.getIdToken();
          const response = await fetch('/api/gemini-plans', {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!response.ok) throw new Error('Failed to fetch Gemini plans');
          
          const data = await response.json();
          fetchedItems = (data.plans || []).map((p: any) => ({
            id: p.id,
            workoutName: p.runType, // Using runType as workout name for Gemini plans
            distance: p.distance,
            runType: p.runType,
            description: p.description,
            date: p.date
          }));
        }

        setItems(fetchedItems);

        // Fetch Weather for these dates (Oranienburg: 52.75, 13.24)
        if (fetchedItems.length > 0) {
          // Extend to 14 days forecast
          const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=52.75&longitude=13.24&hourly=temperature_2m,weathercode,wind_speed_10m&timezone=auto&forecast_days=14`;
          const weatherRes = await fetch(weatherUrl);
          
          if (weatherRes.ok) {
            const weatherData = await weatherRes.json();
            const weatherMap: WeatherData = {};
            
            // Map 8 AM for each available date in the forecast
            weatherData.hourly.time.forEach((timeStr: string, index: number) => {
              if (timeStr.endsWith('T08:00')) {
                const dateKey = timeStr.split('T')[0];
                weatherMap[dateKey] = {
                  temp: Math.round(weatherData.hourly.temperature_2m[index]),
                  emoji: getWeatherEmoji(weatherData.hourly.weathercode[index]),
                  windSpeed: Math.round(weatherData.hourly.wind_speed_10m[index])
                };
              }
            });
            setWeather(weatherMap);
          }
        }
      } catch (err: unknown) {
        console.error('Error:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchPlannedRunsAndWeather();
  }, [coachingMode]);

  const parseRunnaEvent = (event: CalendarEvent) => {
    const summary = event.summary.replace(/🏃/g, '').trim();
    let desc = event.description ? event.description.replace(/<[^>]*>?/gm, '') : '';

    // Remove everything right from 📲
    if (desc.includes('📲')) {
      desc = desc.split('📲')[0].trim();
    }

    const workoutName = summary.split('•')[0].trim();
    const parts = summary.split('•').map(p => p.trim());
    const distance = parts.length > 1 ? parts[1] : '-';

    // 1. Get runType
    const content = (workoutName + ' ' + desc).toLowerCase();
    let runType = 'Other';
    if (content.includes('race')) runType = 'Race';
    else if (content.includes('long run')) runType = 'Long Run';
    else if (content.includes('tempo')) runType = 'Tempo';
    else if (content.includes('interval')) runType = 'Intervals';
    else if (content.includes('easy')) runType = 'Easy Run';
    else if (content.includes('rest')) runType = 'Rest Day';

    // 2. Initial details from summary
    const summaryMatch = summary.match(/•[^•]+•\s*[\dhms]+\s*-\s*[\dhms]+\s+(.*)/i) || 
                         summary.match(/•[^•]+•\s*[\dhms]+\s+(.*)/i);
    let summaryDetails = summaryMatch ? summaryMatch[1].trim() : '';

    // 3. Improve details from description (keep multi-line instructions for hover)
    let instructionBlock = '';
    if (desc) {
      const lines = desc.split('\n').map(l => l.trim());
      let detailsIndex = 0;
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i].toLowerCase();
        if (line.startsWith('type:') || line.startsWith('distance:') || line.startsWith('duration:')) {
          detailsIndex = i + 1;
        }
      }
      
      const workoutLines = lines.slice(detailsIndex);
      // Remove the first line as it usually duplicates the summary details
      instructionBlock = workoutLines.slice(1).join('\n').trim();
    }

    // Final cleanup of 📲
    if (summaryDetails.includes('📲')) summaryDetails = summaryDetails.split('📲')[0].trim();
    if (instructionBlock.includes('📲')) instructionBlock = instructionBlock.split('📲')[0].trim();
    
    return { 
      workoutName, 
      distance, 
      runType, 
      description: instructionBlock || summaryDetails 
    };
  };

  if (loading) {
    return (
      <div className="mt-12 py-10 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Fetching Planned Runs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-12 p-8 bg-white rounded-2xl border border-red-100 shadow-sm text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-black text-gray-900 uppercase tracking-tight">Calendar Sync Paused</p>
            <p className="text-xs text-gray-500 font-medium mt-1">{error}</p>
          </div>
          <button 
            onClick={() => {
              sessionStorage.removeItem('google_calendar_token');
              window.location.reload();
            }}
            className="px-6 py-2 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Authorize Calendar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">
          Planned Runs ({coachingMode === 'runna' ? 'Runna' : 'Gemini AI'})
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Oranienburg 08:00</span>
          <span className="text-xs text-blue-600 font-black uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
            {coachingMode === 'runna' ? 'Calendar Sync' : 'AI Generation'}
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-white p-8 rounded-xl shadow-md border border-gray-100 text-center">
          <p className="text-gray-700 font-medium italic">
            {coachingMode === 'runna' 
              ? 'No upcoming runs found in your Runna calendar.'
              : 'No Gemini training plan found. Ask the coach to generate one!'}
          </p>
        </div>
      ) : (
        <div className="bg-white shadow-md rounded-xl border border-gray-100 overflow-visible">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Weather</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Workout Name</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Run Type</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Distance</th>
                <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item) => {
                const dateObj = item.date ? new Date(item.date) : null;
                
                // Skip if it's today and we already ran
                const isToday = dateObj && dateObj.toDateString() === new Date().toDateString();
                if (isToday && hasRunToday) return null;

                // Create a local date key (YYYY-MM-DD) that matches Open-Meteo format
                let dateKey = '';
                if (dateObj) {
                  const year = dateObj.getFullYear();
                  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                  const day = String(dateObj.getDate()).padStart(2, '0');
                  dateKey = `${year}-${month}-${day}`;
                }
                
                const { workoutName, distance, runType, description } = item;
                const dayWeather = weather[dateKey];
                const isWindy = dayWeather && dayWeather.windSpeed > 20;
                
                return (
                  <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
                      {dateObj ? dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '') : 'TBD'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800">
                      {dayWeather ? (
                        <div className="flex items-center gap-2">
                          <span title={`Wind: ${dayWeather.windSpeed} km/h`}>{dayWeather.emoji}</span>
                          <span>{dayWeather.temp}°</span>
                          {isWindy && (
                            <span title={`Strong wind warning: ${dayWeather.windSpeed} km/h`} className="animate-pulse">
                              🚩
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic text-[10px]">No data</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-black uppercase tracking-tight">
                      {workoutName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-3 py-1 inline-flex text-[10px] leading-5 font-black uppercase rounded-full ${
                        runType.toLowerCase().includes('easy') ? 'bg-green-100 text-green-700' :
                        runType.toLowerCase().includes('long') ? 'bg-blue-100 text-blue-700' :
                        runType.toLowerCase().includes('tempo') ? 'bg-purple-100 text-purple-700' :
                        runType.toLowerCase().includes('intervals') ? 'bg-orange-100 text-orange-700' :
                        runType.toLowerCase().includes('race') ? 'bg-red-200 text-red-900 border border-red-300' :
                        runType.toLowerCase().includes('rest') ? 'bg-gray-100 text-gray-500' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {runType}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-black">
                      {distance}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-md relative group/details">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium italic flex-1">
                          {description || 'No details provided'}
                        </p>
                      </div>
                      
                      {description && (
                        <div className="invisible group-hover/details:visible absolute z-[110] bottom-full left-0 mb-3 w-80 p-6 bg-white text-gray-900 text-[13px] rounded-2xl shadow-2xl border border-gray-200 pointer-events-none transition-all opacity-0 group-hover/details:opacity-100 transform translate-y-1 group-hover/details:translate-y-0 leading-relaxed font-medium border-t-4 border-t-blue-500">
                          <div className="mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Workout Instructions</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{workoutName}</span>
                          </div>
                          <div className="space-y-3 prose-sm">
                            <ReactMarkdown
                              components={{
                                ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                li: ({node, ...props}) => <li className="pl-1" {...props} />,
                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                              }}
                            >
                              {description}
                            </ReactMarkdown>
                          </div>
                          <div className="absolute top-full left-6 border-8 border-transparent border-t-white drop-shadow-sm"></div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
