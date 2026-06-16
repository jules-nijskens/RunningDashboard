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
  startTime?: string;
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        setCoachingMode(docSnap.data().coachingMode || 'runna');
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSyncCalendar = async () => {
    const token = sessionStorage.getItem('google_calendar_token');
    const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;

    if (!token || !calendarId) {
      setSyncStatus({ type: 'error', text: 'Auth token or Calendar ID missing. Try signing in again.' });
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);

    try {
      // 1. Clear existing Gemini-generated events (from start of today)
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      
      // BROAD SEARCH: Get all events from today onwards to ensure we find everything
      const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(startOfToday.toISOString())}&singleEvents=true&maxResults=250`;
      
      console.log("Sync: Fetching events to clear...", listUrl);
      const listRes = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const events = listData.items || [];
        console.log(`Sync: Found ${events.length} total upcoming events.`);
        
        // FILTER: Catch anything that looks like a training run we created
        const toDelete = events.filter((event: any) => {
          const summary = event.summary || '';
          const isGemini = event.extendedProperties?.private?.source === 'gemini';
          // Check for the runner emoji or typical Runna/Gemini patterns in summary
          const isRunEvent = summary.includes('🏃') || summary.includes('•');
          
          return isGemini || isRunEvent;
        });

        console.log(`Sync: Identified ${toDelete.length} events for deletion.`);

        if (toDelete.length > 0) {
          // Delete sequentially to be safe and avoid rate limits/race conditions
          for (const event of toDelete) {
            console.log(`Sync: Deleting event "${event.summary}" (${event.id})`);
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
          console.log("Sync: Deletion phase complete.");
        }
      } else {
        const errorText = await listRes.text();
        console.error("Sync: Failed to list events", errorText);
      }

      // 2. Push new plan
      let successCount = 0;
      for (const item of items) {
        const dateStr = item.date; // Expecting YYYY-MM-DD
        const timeStr = item.startTime || '07:15';
        
        // Create local date string then convert to ISO for Google API
        const startDateTime = new Date(`${dateStr}T${timeStr}:00`);
        // Duration estimate for calendar (default 1 hour)
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

        const event = {
          summary: `🏃 ${item.workoutName}${item.distance !== '-' ? ` • ${item.distance}` : ''}`,
          description: item.description,
          start: { dateTime: startDateTime.toISOString() },
          end: { dateTime: endDateTime.toISOString() },
          extendedProperties: {
            private: { source: 'gemini' }
          }
        };

        const pushRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        });

        if (pushRes.ok) successCount++;
      }

      setSyncStatus({ 
        type: 'success', 
        text: `Successfully synced ${successCount} workouts to your calendar!` 
      });
    } catch (err) {
      console.error("Sync Error:", err);
      setSyncStatus({ type: 'error', text: 'Failed to sync with Google Calendar.' });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

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
            date: p.date,
            startTime: p.startTime
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
          
          {coachingMode === 'gemini' && items.length > 0 && (
            <button
              onClick={handleSyncCalendar}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                isSyncing 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-white text-blue-600 border-2 border-blue-600 hover:bg-blue-600 hover:text-white shadow-sm'
              }`}
            >
              {isSyncing ? (
                <>
                  <div className="animate-spin h-2 w-2 border-b-2 border-current rounded-full"></div>
                  Syncing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync to Calendar
                </>
              )}
            </button>
          )}

          <span className="text-xs text-blue-600 font-black uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
            {coachingMode === 'runna' ? 'Calendar Sync' : 'AI Generation'}
          </span>
        </div>
      </div>

      {syncStatus && (
        <div className={`p-3 rounded-xl text-center text-[11px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-top-2 duration-300 ${
          syncStatus.type === 'success' 
            ? 'bg-green-50 text-green-700 border border-green-100' 
            : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {syncStatus.text}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white p-8 rounded-xl shadow-md border border-gray-100 text-center">
          <p className="text-gray-700 font-medium italic">
            {coachingMode === 'runna' 
              ? 'No upcoming runs found in your Runna calendar.'
              : 'No Gemini training plan found. Ask the coach to generate one!'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Desktop Table View */}
          <div className="hidden md:block bg-white shadow-md rounded-xl border border-gray-100 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Weather</th>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Workout</th>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Dist.</th>
                  <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Instructions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => <DesktopRow key={item.id} item={item} weather={weather} hasRunToday={hasRunToday} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {items.map((item) => <MobileCard key={item.id} item={item} weather={weather} hasRunToday={hasRunToday} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopRow({ item, weather, hasRunToday }: { item: WorkoutItem, weather: WeatherData, hasRunToday: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const dateObj = item.date ? new Date(item.date) : null;
  const isToday = dateObj && dateObj.toDateString() === new Date().toDateString();
  if (isToday && hasRunToday) return null;

  let dateKey = '';
  if (dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    dateKey = `${year}-${month}-${day}`;
  }
  
  const dayWeather = weather[dateKey];
  const isWindy = dayWeather && dayWeather.windSpeed > 20;

  return (
    <>
      <tr 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
      >
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
          <div className="flex flex-col">
            <span>{dateObj ? dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : 'TBD'}</span>
            {item.startTime && <span className="text-[10px] text-gray-400 font-medium">{item.startTime}</span>}
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800">
          {dayWeather ? (
            <div className="flex items-center gap-2">
              <span title={`Wind: ${dayWeather.windSpeed} km/h`}>{dayWeather.emoji}</span>
              <span>{dayWeather.temp}°</span>
              {isWindy && <span title={`Strong wind warning: ${dayWeather.windSpeed} km/h`}>🚩</span>}
            </div>
          ) : <span className="text-gray-400 italic text-[10px]">--</span>}
        </td>
        <td className="px-6 py-4 text-sm text-blue-600 font-black uppercase tracking-tight">
          {item.workoutName}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          <RunTypeBadge type={item.runType} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-black">
          {item.distance}
        </td>
        <td className="px-6 py-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <p className="truncate max-w-[200px] font-medium italic">
              {item.description || 'No instructions'}
            </p>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-blue-50/30">
          <td colSpan={6} className="px-12 py-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Detailed Instructions</span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{item.workoutName} • {item.distance}</span>
              </div>
              <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed font-medium">
                <ReactMarkdown
                  components={{
                    ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                    li: ({node, ...props}) => <li className="pl-1" {...props} />,
                    p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                  }}
                >
                  {item.description || "No specific instructions provided for this session."}
                </ReactMarkdown>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MobileCard({ item, weather, hasRunToday }: { item: WorkoutItem, weather: WeatherData, hasRunToday: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const dateObj = item.date ? new Date(item.date) : null;
  const isToday = dateObj && dateObj.toDateString() === new Date().toDateString();
  if (isToday && hasRunToday) return null;

  let dateKey = '';
  if (dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    dateKey = `${year}-${month}-${day}`;
  }
  
  const dayWeather = weather[dateKey];

  return (
    <div 
      onClick={() => setIsExpanded(!isExpanded)}
      className={`bg-white rounded-2xl border transition-all active:scale-[0.98] ${
        isExpanded ? 'border-blue-200 shadow-lg' : 'border-gray-100 shadow-sm'
      }`}
    >
      <div className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-col">
            <span className="text-sm font-black text-gray-900">
              {dateObj ? dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : 'TBD'}
            </span>
            {item.startTime && <span className="text-[10px] text-gray-400 font-bold uppercase">{item.startTime}</span>}
          </div>
          {dayWeather && (
            <div className="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
              <span className="text-sm">{dayWeather.emoji}</span>
              <span className="text-xs font-black text-gray-700">{dayWeather.temp}°</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-black text-blue-600 uppercase tracking-tight truncate max-w-[70%]">
              {item.workoutName}
            </h3>
            <span className="text-sm font-black text-gray-900">{item.distance}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <RunTypeBadge type={item.runType} />
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-5 pt-2 border-t border-gray-50 bg-blue-50/10 animate-in fade-in duration-200">
          <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed font-medium">
            <ReactMarkdown
              components={{
                ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                li: ({node, ...props}) => <li className="pl-1" {...props} />,
                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
              }}
            >
              {item.description || "No specific instructions provided."}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function RunTypeBadge({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  const styles = 
    normalized.includes('easy') ? 'bg-green-100 text-green-700' :
    normalized.includes('long') ? 'bg-blue-100 text-blue-700' :
    normalized.includes('tempo') ? 'bg-purple-100 text-purple-700' :
    normalized.includes('intervals') ? 'bg-orange-100 text-orange-700' :
    normalized.includes('race') ? 'bg-red-200 text-red-900 border border-red-300' :
    normalized.includes('rest') ? 'bg-gray-100 text-gray-500' :
    'bg-gray-100 text-gray-700';

  return (
    <span className={`px-3 py-1 inline-flex text-[10px] leading-5 font-black uppercase rounded-full ${styles}`}>
      {type}
    </span>
  );
}
