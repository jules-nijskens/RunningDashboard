'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, where } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import ReactMarkdown from 'react-markdown';
import { Run, Workout } from '@/types/run';

interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  description?: string;
  extendedProperties?: {
    private?: {
      source?: string;
    };
  };
}

interface RescheduledGymWorkout {
  id: string;
  date: string;
  originalDate: string;
  type: string;
}

interface WorkoutItem {
  id: string;
  workoutName: string;
  distance: string;
  runType: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
}

interface HourlyWeatherPoint {
  hour: number;
  temp: number;
  emoji: string;
  windSpeed: number;
  rainProb: number;
}

interface WeatherData {
  [date: string]: {
    temp: number;
    emoji: string;
    windSpeed: number;
    hourly?: HourlyWeatherPoint[];
  };
}

interface CustomEventItem {
  id: string;
  date: string;
  startTime?: string;
  title: string;
  type: 'social' | 'music' | 'work' | 'other';
  description?: string;
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

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Parser helper moved to top and typed strictly
const parseRunnaEvent = (event: CalendarEvent) => {
  const summary = event.summary.replace(/🏃/g, '').trim();
  let desc = event.description ? event.description.replace(/<[^>]*>?/gm, '') : '';

  if (desc.includes('📲')) {
    desc = desc.split('📲')[0].trim();
  }

  const workoutName = summary.split('•')[0].trim();
  const parts = summary.split('•').map(p => p.trim());
  const distance = parts.length > 1 ? parts[1] : '-';

  const content = (workoutName + ' ' + desc).toLowerCase();
  let runType = 'Other';
  if (content.includes('race')) runType = 'Race';
  else if (content.includes('long run')) runType = 'Long Run';
  else if (content.includes('tempo')) runType = 'Tempo';
  else if (content.includes('interval')) runType = 'Intervals';
  else if (content.includes('easy')) runType = 'Easy Run';
  else if (content.includes('rest')) runType = 'Rest Day';

  const summaryMatch = summary.match(/•[^•]+•\s*[\dhms]+\s*-\s*[\dhms]+\s+(.*)/i) || 
                       summary.match(/•[^•]+•\s*[\dhms]+\s+(.*)/i);
  let summaryDetails = summaryMatch ? summaryMatch[1].trim() : '';

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
    
    let workoutLines = lines.slice(detailsIndex);
    while (workoutLines.length > 0 && !workoutLines[0]) {
      workoutLines.shift();
    }

    if (workoutLines.length > 0) {
      const firstLineNorm = workoutLines[0].toLowerCase().replace(/\s+/g, '');
      const summaryNorm = summary.toLowerCase().replace(/\s+/g, '');
      const workoutNameNorm = workoutName.toLowerCase().replace(/\s+/g, '');
      const distanceNorm = distance.toLowerCase().replace(/\s+/g, '');
      const nameDistNorm = `${workoutNameNorm}${distanceNorm}`;

      const isDuplicate = firstLineNorm === summaryNorm || 
                          firstLineNorm === nameDistNorm ||
                          (workoutLines[0].length < 30 && firstLineNorm === workoutNameNorm);
      if (isDuplicate) {
        workoutLines = workoutLines.slice(1);
      }
    }
    
    instructionBlock = workoutLines.join('\n').trim();
  }

  if (summaryDetails.includes('📲')) summaryDetails = summaryDetails.split('📲')[0].trim();
  if (instructionBlock.includes('📲')) instructionBlock = instructionBlock.split('📲')[0].trim();
  
  return { 
    workoutName, 
    distance, 
    runType, 
    description: instructionBlock || summaryDetails 
  };
};

const getFormatDate = (date: Date) => {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function PlannedRuns() {
  const [items, setItems] = useState<WorkoutItem[]>([]);
  const [pastRuns, setPastRuns] = useState<Run[]>([]);
  const [pastWorkouts, setPastWorkouts] = useState<Workout[]>([]);
  const [customEvents, setCustomEvents] = useState<CustomEventItem[]>([]);
  const [coachingMode, setCoachingMode] = useState<'runna' | 'gemini'>('runna');
  const [weather, setWeather] = useState<WeatherData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Calendar view states
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'2weeks' | 'month'>('2weeks');

  // Custom Event modal state
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [eventType, setEventType] = useState<'social' | 'music' | 'work' | 'other'>('social');
  const [eventTime, setEventTime] = useState('18:00');
  const [eventDesc, setEventDesc] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Side Drawer for gym workouts
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Modal for planned run details
  const [selectedPlannedRun, setSelectedPlannedRun] = useState<WorkoutItem | null>(null);

  // Drag over state
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Filter states
  const [showCompletedRuns, setShowCompletedRuns] = useState(true);
  const [showGymWorkouts, setShowGymWorkouts] = useState(true);
  const [showPlannedRuns, setShowPlannedRuns] = useState(true);
  const [showCustomEvents, setShowCustomEvents] = useState(true);

  const [dismissedGymWorkouts, setDismissedGymWorkouts] = useState<string[]>([]);

  // 0. Subscribe to dismissed gym workouts
  useEffect(() => {
    const q = collection(db, 'dismissed_gym_workouts');
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const ids: string[] = [];
      querySnapshot.forEach((docSnap) => {
        ids.push(docSnap.id);
      });
      setDismissedGymWorkouts(ids);
    }, (err) => {
      console.error("Error fetching dismissed gym workouts:", err);
    });
    return () => unsubscribe();
  }, []);

  const [rescheduledGymWorkouts, setRescheduledGymWorkouts] = useState<RescheduledGymWorkout[]>([]);

  // Subscribe to rescheduled gym workouts
  useEffect(() => {
    const q = collection(db, 'rescheduled_gym_workouts');
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const items: RescheduledGymWorkout[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          date: data.date || '',
          originalDate: data.originalDate || '',
          type: data.type || ''
        });
      });
      setRescheduledGymWorkouts(items);
    }, (err) => {
      console.error("Error fetching rescheduled gym workouts:", err);
    });
    return () => unsubscribe();
  }, []);

  // 1. Subscribe to coachingMode settings
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        setCoachingMode(docSnap.data().coachingMode || 'runna');
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch past Garmin runs
  useEffect(() => {
    const q = query(collection(db, 'runs'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const runsData: Run[] = [];
      querySnapshot.forEach((docSnap) => {
        runsData.push({ id: docSnap.id, ...docSnap.data() } as Run);
      });
      setPastRuns(runsData);
    }, (err) => {
      console.error("Error fetching runs:", err);
    });
    return () => unsubscribe();
  }, []);

  // 3. Fetch past gym workouts & custom events
  useEffect(() => {
    const fetchWorkoutsAndEvents = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        // Workouts
        const wRes = await fetch('/api/workouts', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (wRes.ok) {
          const wData = await wRes.json();
          setPastWorkouts(wData.workouts || []);
        }

        // Custom events
        const ceRes = await fetch('/api/custom-events', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (ceRes.ok) {
          const ceData = await ceRes.json();
          setCustomEvents(ceData.events || []);
        }
      } catch (err) {
        console.error("Error fetching workouts or events:", err);
      }
    };

    fetchWorkoutsAndEvents();
  }, []);

  // 4. Fetch weather and planned runs when coachingMode changes
  useEffect(() => {
    let unsubscribeGemini: (() => void) | null = null;

    const fetchPlannedRunsAndWeather = async () => {
      setLoading(true);
      setError(null);

      try {
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

          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          const timeMin = ninetyDaysAgo.toISOString();
          const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=150`;
          
          const response = await fetch(calendarUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) throw new Error('Calendar session expired.');
            throw new Error(`Calendar API error: ${errorData.error?.message || 'Failed to fetch'}`);
          }

          const data = await response.json();
          const events: CalendarEvent[] = data.items || [];
          const fetchedItems = events.map(event => {
            const { workoutName, distance, runType, description } = parseRunnaEvent(event);
            return {
              id: event.id,
              workoutName,
              distance,
              runType,
              description,
              date: (event.start.dateTime || event.start.date || '').split('T')[0]
            };
          });
          setItems(fetchedItems);
          await fetchWeather();
        } else {
          // Gemini Mode - Real-time listener
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          const startDateStr = ninetyDaysAgo.toISOString().split('T')[0];
          
          const q = query(
            collection(db, 'gemini_plans'),
            where('date', '>=', startDateStr),
            orderBy('date', 'asc')
          );
          
          unsubscribeGemini = onSnapshot(q, (querySnapshot) => {
            const fetchedItems: WorkoutItem[] = [];
            querySnapshot.forEach((docSnap) => {
              const p = docSnap.data();
              fetchedItems.push({
                id: docSnap.id,
                workoutName: p.runType || '',
                distance: p.distance || '',
                runType: p.runType || '',
                description: p.description || '',
                date: p.date || '',
                startTime: p.startTime
              });
            });
            setItems(fetchedItems);
            setLoading(false);
          }, (err) => {
            console.error("Error listening to Gemini plans:", err);
            setError("Failed to sync Gemini plans.");
            setLoading(false);
          });
          
          await fetchWeather();
        }
      } catch (err: unknown) {
        console.error('Error:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setLoading(false);
      }
    };

    const fetchWeather = async () => {
      // Fetch Weather (Oranienburg: 52.75, 13.24)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=52.75&longitude=13.24&hourly=temperature_2m,weathercode,wind_speed_10m,precipitation_probability&timezone=auto&forecast_days=14`;
      const weatherRes = await fetch(weatherUrl);
      
      if (weatherRes.ok) {
        const weatherData = await weatherRes.json();
        const weatherMap: WeatherData = {};
        
        weatherData.hourly.time.forEach((timeStr: string, index: number) => {
          const dateKey = timeStr.split('T')[0];
          const hour = parseInt(timeStr.split('T')[1].split(':')[0]);
          
          if (!weatherMap[dateKey]) {
            weatherMap[dateKey] = {
              temp: 0,
              emoji: '☀️',
              windSpeed: 0,
              hourly: []
            };
          }
          
          const hourData: HourlyWeatherPoint = {
            hour,
            temp: Math.round(weatherData.hourly.temperature_2m[index]),
            emoji: getWeatherEmoji(weatherData.hourly.weathercode[index]),
            windSpeed: Math.round(weatherData.hourly.wind_speed_10m[index]),
            rainProb: weatherData.hourly.precipitation_probability ? weatherData.hourly.precipitation_probability[index] : 0
          };
          
          weatherMap[dateKey].hourly?.push(hourData);
          
          if (hour === 8) {
            weatherMap[dateKey].temp = hourData.temp;
            weatherMap[dateKey].emoji = hourData.emoji;
            weatherMap[dateKey].windSpeed = hourData.windSpeed;
          }
        });
        setWeather(weatherMap);
      }
    };

    fetchPlannedRunsAndWeather();
    
    return () => {
      if (unsubscribeGemini) {
        unsubscribeGemini();
      }
    };
  }, [coachingMode]);

  // Google Calendar Push (for Gemini Plans)
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
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      
      const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(startOfToday.toISOString())}&singleEvents=true&maxResults=250`;
      const listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${token}` } });

      if (listRes.ok) {
        const listData = await listRes.json();
        const events: CalendarEvent[] = listData.items || [];
        const toDelete = events.filter((event: CalendarEvent) => {
          const summary = event.summary || '';
          const isGemini = event.extendedProperties?.private?.source === 'gemini';
          const isRunEvent = summary.includes('🏃') || summary.includes('•');
          return isGemini || isRunEvent;
        });

        if (toDelete.length > 0) {
          for (const event of toDelete) {
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      }

      let successCount = 0;
      for (const item of items) {
        const dateStr = item.date;
        const timeStr = item.startTime || '07:15';
        const startDateTime = new Date(`${dateStr}T${timeStr}:00`);
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

        const event = {
          summary: `🏃 ${item.workoutName}${item.distance !== '-' ? ` • ${item.distance}` : ''}`,
          description: item.description,
          start: { dateTime: startDateTime.toISOString() },
          end: { dateTime: endDateTime.toISOString() },
          extendedProperties: { private: { source: 'gemini' } }
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

  // --- CALENDAR GENERATION HELPERS ---
  const getMonday = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getTwoWeeksDates = (startDate: Date) => {
    const dates = [];
    const tempDate = new Date(startDate);
    for (let i = 0; i < 14; i++) {
      dates.push(new Date(tempDate));
      tempDate.setDate(tempDate.getDate() + 1);
    }
    return dates;
  };

  const getMonthDates = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const start = new Date(firstDay);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const dates = [];
    const tempDate = new Date(start);
    // Standard 42 days grid for monthly view
    for (let i = 0; i < 42; i++) {
      dates.push(new Date(tempDate));
      tempDate.setDate(tempDate.getDate() + 1);
    }
    return dates;
  };

  // Date lists
  const currentMonday = getMonday(currentDate);
  const calendarDates = viewMode === '2weeks' 
    ? getTwoWeeksDates(currentMonday) 
    : getMonthDates(currentDate);

  const handlePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === '2weeks') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === '2weeks') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // --- DRAG AND DROP HANDLERS ---
  const handleDragStart = (e: React.DragEvent, type: 'planned' | 'custom' | 'gym-workout', id: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    try {
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      const { type, id } = JSON.parse(dataStr);

      if (type === 'custom') {
        const eventToMove = customEvents.find(ev => ev.id === id);
        if (!eventToMove) return;

        const originalEvents = [...customEvents];
        // Optimistic UI update
        setCustomEvents(customEvents.map(ev => ev.id === id ? { ...ev, date: targetDateStr } : ev));

        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const body = {
          id,
          date: targetDateStr,
          startTime: eventToMove.startTime || '18:00',
          title: eventToMove.title,
          type: eventToMove.type,
          description: eventToMove.description || ''
        };

        const res = await fetch('/api/custom-events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          setCustomEvents(originalEvents);
          alert('Failed to save rescheduled event.');
        }
      } else if (type === 'planned') {
        const planToMove = items.find(p => p.id === id);
        if (!planToMove) return;

        const originalItems = [...items];
        // Optimistic UI update
        setItems(items.map(p => p.id === id ? { ...p, date: targetDateStr } : p));

        if (coachingMode === 'runna') {
          const token = sessionStorage.getItem('google_calendar_token');
          const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;

          if (!token || !calendarId) {
            setItems(originalItems);
            alert("No calendar access token found. Please sign in again.");
            return;
          }

          try {
            // Get original event to preserve times/details
            const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
            const getRes = await fetch(getUrl, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!getRes.ok) throw new Error("Failed to fetch calendar event");
            
            const event = await getRes.json();
            const patchBody: { start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } } = {};
            
            if (event.start?.date) {
              patchBody.start = { date: targetDateStr };
              patchBody.end = { date: targetDateStr };
            } else if (event.start?.dateTime) {
              const originalStartStr = event.start.dateTime;
              const originalEndStr = event.end.dateTime;
              
              const timePartStart = originalStartStr.includes('T') ? originalStartStr.split('T')[1] : '07:15:00Z';
              const timePartEnd = originalEndStr.includes('T') ? originalEndStr.split('T')[1] : '08:15:00Z';
              
              patchBody.start = { dateTime: `${targetDateStr}T${timePartStart}` };
              patchBody.end = { dateTime: `${targetDateStr}T${timePartEnd}` };
            }

            const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
            const patchRes = await fetch(patchUrl, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(patchBody)
            });

            if (!patchRes.ok) {
              throw new Error("Failed to patch calendar event");
            }
          } catch (err) {
            console.error("Google Calendar event move failed:", err);
            setItems(originalItems);
            alert('Failed to save rescheduled Google Calendar event.');
          }
        } else {
          // Gemini Mode
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;

            const res = await fetch('/api/gemini-plans', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ id, date: targetDateStr })
            });

            if (!res.ok) {
              setItems(originalItems);
              alert('Failed to save rescheduled workout plan.');
            }
          } catch (err) {
            console.error("Gemini plan move failed:", err);
            setItems(originalItems);
            alert('Failed to save rescheduled workout plan.');
          }
        }
      } else if (type === 'gym-workout') {
        const originalDate = id.slice(-10); // Extract date from "planned-gym-wed-YYYY-MM-DD"
        const isWed = id.includes('wed');
        const gymType = isWed ? 'office' : 'home';

        try {
          const token = await auth.currentUser?.getIdToken();
          if (!token) return;

          await setDoc(doc(db, 'rescheduled_gym_workouts', id), {
            originalDate,
            date: targetDateStr,
            type: gymType,
            updatedAt: new Date().toISOString()
          });
        } catch (err) {
          console.error("Failed to reschedule gym workout:", err);
          alert("Failed to reschedule gym workout.");
        }
      }
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  // --- CUSTOM EVENTS ADD/EDIT/DELETE ---
  const openAddEventModal = (date: Date) => {
    setSelectedDate(date);
    setEventTitle('');
    setEventType('social');
    setEventTime('18:00');
    setEventDesc('');
    setEditingEventId(null);
    setIsEventModalOpen(true);
  };

  const openEditEventModal = (e: React.MouseEvent, event: CustomEventItem) => {
    e.stopPropagation(); // Avoid triggering cell click
    setSelectedDate(new Date(event.date));
    setEventTitle(event.title);
    setEventType(event.type);
    setEventTime(event.startTime || '18:00');
    setEventDesc(event.description || '');
    setEditingEventId(event.id);
    setIsEventModalOpen(true);
  };

  const closeEventModal = () => {
    setIsEventModalOpen(false);
    setSelectedDate(null);
    setEventTitle('');
    setEditingEventId(null);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !eventTitle.trim()) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const dateStr = getLocalDateKey(selectedDate);
      const body = {
        id: editingEventId || undefined,
        date: dateStr,
        startTime: eventTime,
        title: eventTitle.trim(),
        type: eventType,
        description: eventDesc.trim()
      };

      const res = await fetch('/api/custom-events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const saved = await res.json();
        if (editingEventId) {
          setCustomEvents(customEvents.map(ev => ev.id === editingEventId ? saved : ev));
        } else {
          setCustomEvents([...customEvents, saved]);
        }
        closeEventModal();
      }
    } catch (err) {
      console.error("Failed to save event:", err);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this event?")) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const res = await fetch(`/api/custom-events?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        setCustomEvents(customEvents.filter(ev => ev.id !== id));
        closeEventModal();
      }
    } catch (err) {
      console.error("Failed to delete event:", err);
    }
  };

  const handleRemovePlannedGym = async (id: string, dateStr: string) => {
    if (!window.confirm("Are you sure you want to remove this planned gym workout?")) return;

    try {
      await setDoc(doc(db, 'dismissed_gym_workouts', id), {
        dismissedAt: new Date().toISOString(),
        date: dateStr
      });
    } catch (err) {
      console.error("Failed to remove planned gym workout:", err);
    }
  };

  // --- RENDERING PARSERS FOR CELLS ---
  const getDayItems = (dayDate: Date) => {
    const dateStr = getLocalDateKey(dayDate);
    const warnings: string[] = [];

    // Completed Runs
    const runs = showCompletedRuns 
      ? pastRuns.filter(r => getLocalDateKey(new Date(r.timestamp)) === dateStr)
      : [];

    // Gym Workouts
    const gym = showGymWorkouts 
      ? pastWorkouts.filter(w => getLocalDateKey(new Date(w.date)) === dateStr)
      : [];

    // Planned runs/workouts
    let planned = showPlannedRuns 
      ? items.filter(p => p.date === dateStr)
      : [];

    // Hide planned runs if a run was completed on this date
    const hasCompletedRun = pastRuns.some(r => getLocalDateKey(new Date(r.timestamp)) === dateStr);
    if (hasCompletedRun) {
      planned = [];
    }

    // Custom events
    const custom = showCustomEvents 
      ? customEvents.filter(e => e.date === dateStr)
      : [];

    // Planned gym workouts
    let plannedGym: { id: string; type: string; date: string }[] = [];
    if (showGymWorkouts) {
      const dayOfWeek = dayDate.getDay();
      const wedId = `planned-gym-wed-${dateStr}`;
      const friId = `planned-gym-fri-${dateStr}`;

      const wedRescheduled = rescheduledGymWorkouts.find(r => r.id === wedId);
      const friRescheduled = rescheduledGymWorkouts.find(r => r.id === friId);

      // If standard Wednesday is NOT rescheduled away, and NOT dismissed, add it
      if (dayOfWeek === 3 && !dismissedGymWorkouts.includes(wedId) && (!wedRescheduled || wedRescheduled.date === dateStr)) {
        plannedGym.push({
          id: wedId,
          type: 'office',
          date: dateStr
        });
      }

      // If standard Friday is NOT rescheduled away, and NOT dismissed, add it
      if (dayOfWeek === 5 && !dismissedGymWorkouts.includes(friId) && (!friRescheduled || friRescheduled.date === dateStr)) {
        plannedGym.push({
          id: friId,
          type: 'home',
          date: dateStr
        });
      }

      // Check for gym workouts rescheduled TO this date
      rescheduledGymWorkouts.forEach(r => {
        if (r.date === dateStr && r.originalDate !== dateStr) {
          if (!dismissedGymWorkouts.includes(r.id)) {
            plannedGym.push({
              id: r.id,
              type: r.type,
              date: dateStr
            });
          }
        }
      });
    }

    // Hide planned gym workouts if completed on this date
    const hasCompletedGym = pastWorkouts.some(w => getLocalDateKey(new Date(w.date)) === dateStr);
    if (hasCompletedGym) {
      plannedGym = [];
    }

    // --- CONFLICT & RECOVERY ALERT DETECTION ---
    if (planned.length > 0) {
      // 1. Fatigue / Recovery Warning (drinks or concert scheduled D-1)
      const prevDate = new Date(dayDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = getLocalDateKey(prevDate);
      
      const prevCustom = customEvents.filter(e => e.date === prevDateStr);
      const eveningEvent = prevCustom.find(e => {
        const isFatiguingType = e.type === 'social' || e.type === 'music';
        if (!isFatiguingType) return false;
        if (!e.startTime) return true; // Assume late if time not specified
        const [h] = e.startTime.split(':').map(Number);
        return h >= 17; // Starts at or after 5 PM
      });

      if (eveningEvent) {
        warnings.push(`Recovery Tip: "${eveningEvent.title}" last night may impact today's planned run. Proactively run at a lower intensity or monitor your HRV.`);
      }

      // 2. Schedule Overlap Warning (run window conflicts)
      const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
      const runStartMin = isWeekend ? 9 * 60 : 7 * 60 + 15; // Weekdays 07:15, Weekends 09:00
      const runEndMin = isWeekend ? 11 * 60 : 8 * 60 + 45;   // 1.5 - 2 hour window
      
      custom.forEach(e => {
        if (!e.startTime) return;
        const [h, m] = e.startTime.split(':').map(Number);
        const eventMin = h * 60 + m;
        const overlaps = eventMin >= runStartMin - 30 && eventMin <= runEndMin + 15;
        if (overlaps) {
          warnings.push(`Schedule Warning: "${e.title}" (${e.startTime}) overlaps with your scheduled morning run window (${isWeekend ? '09:00' : '07:15'}).`);
        }
      });
    }

    return { runs, gym, planned, custom, warnings, plannedGym };
  };

  return (
    <div className="mt-12 space-y-6">
      {/* Calendar Header with Controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">
            Schedule & Training Calendar
          </h2>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">
            {viewMode === '2weeks' && calendarDates.length > 0
              ? `2-Week Planner View (${getFormatDate(calendarDates[0])} - ${getFormatDate(calendarDates[calendarDates.length - 1])})`
              : `${currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`}
          </p>
        </div>

        {/* Sync & AI buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {coachingMode === 'gemini' && items.length > 0 && (
            <button
              onClick={handleSyncCalendar}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isSyncing 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 shadow-sm'
              }`}
            >
              {isSyncing ? 'Syncing...' : 'Sync to Calendar'}
            </button>
          )}

          <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
            <button
              onClick={() => setViewMode('2weeks')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                viewMode === '2weeks' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              2 Weeks
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                viewMode === 'month' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Month
            </button>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
            <button onClick={handlePrev} className="px-2 py-1 hover:bg-gray-200 rounded-lg text-xs font-black">◀</button>
            <button onClick={handleToday} className="px-3 py-1 text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 rounded-lg">Today</button>
            <button onClick={handleNext} className="px-2 py-1 hover:bg-gray-200 rounded-lg text-xs font-black">▶</button>
          </div>
        </div>
      </div>

      {/* Calendar Sync Error Banner */}
      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-4 text-xs font-medium text-amber-800 animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <p><strong>Calendar Sync Paused:</strong> {error}</p>
          </div>
          <button 
            onClick={() => {
              sessionStorage.removeItem('google_calendar_token');
              window.location.reload();
            }}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest text-[9px] rounded-lg transition-colors shadow-sm"
          >
            Reauthorize
          </button>
        </div>
      )}

      {/* Sync Status Banner */}
      {syncStatus && (
        <div className={`p-3 rounded-xl text-center text-[11px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-top-2 duration-300 ${
          syncStatus.type === 'success' 
            ? 'bg-green-50 text-green-700 border border-green-100' 
            : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {syncStatus.text}
        </div>
      )}

      {/* Legend & Filter Controls */}
      <div className="bg-white/60 backdrop-blur-md border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-4 items-center justify-between text-xs">
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => setShowCompletedRuns(!showCompletedRuns)} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
              showCompletedRuns 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold' 
                : 'bg-gray-50 border-gray-200 text-gray-400 line-through'
            }`}
          >
            <span>🏃 Completed Runs</span>
          </button>
          
          <button 
            onClick={() => setShowGymWorkouts(!showGymWorkouts)} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
              showGymWorkouts 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-800 font-bold' 
                : 'bg-gray-50 border-gray-200 text-gray-400 line-through'
            }`}
          >
            <span>🏋️‍♂️ Gym Workouts</span>
          </button>

          <button 
            onClick={() => setShowPlannedRuns(!showPlannedRuns)} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
              showPlannedRuns 
                ? 'bg-blue-50 border-blue-200 text-blue-800 font-bold' 
                : 'bg-gray-50 border-gray-200 text-gray-400 line-through'
            }`}
          >
            <span>📅 Planned Runs ({coachingMode === 'runna' ? 'Runna' : 'Gemini'})</span>
          </button>

          <button 
            onClick={() => setShowCustomEvents(!showCustomEvents)} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
              showCustomEvents 
                ? 'bg-amber-50 border-amber-200 text-amber-800 font-bold' 
                : 'bg-gray-50 border-gray-200 text-gray-400 line-through'
            }`}
          >
            <span>🍻 Custom Life Events</span>
          </button>
        </div>

        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
          Click any day to add customized events
        </span>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Compiling Calendar Data...</p>
        </div>
      ) : (
        <>
          {/* DESKTOP CALENDAR GRID */}
          <div className="hidden md:block bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden">
            {/* Weekdays Headers */}
            <div className="grid grid-cols-7 bg-gray-50/50 border-b border-gray-100 text-center py-4 text-xs font-black text-gray-600 uppercase tracking-widest">
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
              <div>Sun</div>
            </div>

            {/* Calendar Cells */}
            <div className="grid grid-cols-7 gap-px bg-gray-100">
              {/* Scroll Up (Go Back in Time) */}
              <button
                onClick={handlePrev}
                className="col-span-7 py-2 bg-gray-50/50 hover:bg-blue-50/20 border-b border-gray-100 text-gray-400 hover:text-blue-600 flex items-center justify-center transition-colors cursor-pointer group"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transform group-hover:-translate-y-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                </svg>
              </button>

              {calendarDates.map((dayDate, idx) => {
                const dateKey = getLocalDateKey(dayDate);
                const dayWeather = weather[dateKey];
                const { runs, gym, planned, custom, warnings, plannedGym } = getDayItems(dayDate);
                
                const isToday = getLocalDateKey(new Date()) === dateKey;
                const isCurrentMonth = dayDate.getMonth() === currentDate.getMonth() || viewMode === '2weeks';

                return (
                  <div 
                    key={idx}
                    onClick={() => openAddEventModal(dayDate)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverDate(dateKey);
                    }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={(e) => {
                      setDragOverDate(null);
                      handleDrop(e, dateKey);
                    }}
                    className={`aspect-square md:min-h-[160px] p-3 flex flex-col justify-between group relative cursor-pointer hover:bg-blue-50/10 transition-all ${
                      isCurrentMonth ? 'bg-white' : 'bg-gray-50/40 text-gray-300'
                    } ${dragOverDate === dateKey ? 'ring-2 ring-blue-500 bg-blue-50/20 z-10' : ''}`}
                  >
                    {/* Day Number, Warning Badge and Weather */}
                    <div className="flex justify-between items-start w-full">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-base font-black flex items-center justify-center w-8 h-8 rounded-full ${
                          isToday 
                            ? 'bg-blue-600 text-white shadow-lg' 
                            : isCurrentMonth ? 'text-gray-950' : 'text-gray-400'
                        }`}>
                          {dayDate.getDate()}
                        </span>
                        {warnings.length > 0 && (
                          <div className="group/warning relative flex items-center justify-center w-7 h-7 bg-amber-50 border border-amber-100 hover:bg-amber-100 rounded-full transition-colors cursor-help shadow-sm">
                            <span className="text-xs">⚠️</span>
                            {/* Conflict Tooltip */}
                            <div className="absolute top-9 left-1/2 -translate-x-1/2 bg-slate-955 text-white text-[10px] font-bold p-3 rounded-2xl shadow-2xl z-45 w-56 opacity-0 pointer-events-none group-hover/warning:opacity-100 transition-opacity duration-200 leading-normal border border-slate-800">
                              <p className="font-black text-amber-400 uppercase tracking-widest text-[8px] mb-1.5 flex items-center gap-1">
                                <span>🧠</span> AI Coach Warning
                              </p>
                              <ul className="space-y-1 list-none font-medium text-left">
                                {warnings.map((w, wIdx) => (
                                  <li key={wIdx} className="flex gap-1.5 items-start">
                                    <span className="text-amber-500">•</span>
                                    <span>{w}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>

                      {dayWeather && (
                        <div className="group/weather relative flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-gray-50 hover:bg-blue-50 px-2 py-0.5 rounded-lg border border-gray-100 transition-all cursor-help">
                          <span>{dayWeather.emoji}</span>
                          <span>{dayWeather.temp}°</span>
                          
                          {/* Weather Tooltip */}
                          {dayWeather.hourly && (
                            <div className="absolute top-7 right-0 bg-white border border-gray-150 p-3 rounded-2xl shadow-2xl z-45 w-56 opacity-0 pointer-events-none group-hover/weather:opacity-100 transition-opacity duration-200 text-gray-700 leading-normal font-medium">
                              <p className="font-black text-gray-400 uppercase tracking-widest text-[8px] mb-2 border-b border-gray-50 pb-1.5 flex items-center gap-1">
                                <span>🌤️</span> Hourly Forecast
                              </p>
                              <div className="space-y-1.5 text-[10px]">
                                {dayWeather.hourly
                                  .filter(hp => [8, 12, 16, 20].includes(hp.hour))
                                  .map((hp) => (
                                    <div key={hp.hour} className="flex items-center justify-between text-gray-600">
                                      <span className="font-bold">{String(hp.hour).padStart(2, '0')}:00</span>
                                      <span>{hp.emoji}</span>
                                      <span className="font-black text-gray-900 w-8 text-right">{hp.temp}°</span>
                                      <span className="text-blue-500 font-bold w-10 text-right">💧{hp.rainProb}%</span>
                                      <span className="text-gray-400 font-bold w-12 text-right">💨{hp.windSpeed}k</span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Events list */}
                    <div className="flex-1 mt-2 space-y-1.5 overflow-hidden">
                      {/* Completed Runs */}
                      {runs.map(run => (
                        <div
                          key={run.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (run.id) window.location.href = `/runs/${run.id}`;
                          }}
                          className="px-2 py-1 text-xs font-bold bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-lg truncate flex items-center gap-1 hover:bg-emerald-100 transition-colors shadow-sm"
                        >
                          <span>🏃</span>
                          <span className="truncate">{run.runType} • {run.distance}k</span>
                        </div>
                      ))}

                      {/* Completed Workouts */}
                      {gym.map(workout => (
                        <div
                          key={workout.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkout(workout);
                            setIsDrawerOpen(true);
                          }}
                          className="px-2 py-1 text-xs font-bold bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-lg truncate flex items-center gap-1 hover:bg-indigo-100 transition-colors shadow-sm"
                        >
                          <span>🏋️‍♂️</span>
                          <span className="truncate">Gym ({workout.type})</span>
                        </div>
                      ))}

                      {/* Planned Runs */}
                      {planned.map(plannedItem => (
                        <div
                          key={plannedItem.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, 'planned', plannedItem.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPlannedRun(plannedItem);
                          }}
                          className="px-2 py-1 text-xs font-bold bg-blue-50/40 border border-dashed border-blue-200 text-blue-700 rounded-lg truncate flex items-center gap-1 hover:bg-blue-50 transition-colors cursor-grab active:cursor-grabbing"
                        >
                          <span>📅</span>
                          <span className="truncate">{plannedItem.workoutName} ({plannedItem.distance})</span>
                        </div>
                      ))}

                      {/* Planned Gym Workouts */}
                      {plannedGym.map(pg => (
                        <div
                          key={pg.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, 'gym-workout', pg.id)}
                          className="group/gym px-2 py-1 text-xs font-bold bg-indigo-50/40 border border-dashed border-indigo-200 text-indigo-700 rounded-lg truncate flex items-center justify-between hover:bg-indigo-50 transition-colors select-none cursor-grab active:cursor-grabbing"
                          title={`Scheduled Strength Day: ${pg.type}`}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span>🏋️‍♂️</span>
                            <span className="truncate">Planned Gym ({pg.type})</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemovePlannedGym(pg.id, pg.date);
                            }}
                            className="opacity-0 group-hover/gym:opacity-100 text-indigo-400 hover:text-indigo-700 ml-1 font-black text-[10px] px-1 hover:bg-indigo-100 rounded transition-all"
                            title="Remove this planned workout"
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {/* Custom Events */}
                      {custom.map(ev => (
                        <div
                          key={ev.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, 'custom', ev.id)}
                          onClick={(e) => openEditEventModal(e, ev)}
                          className={`group/evt px-2 py-1 text-xs font-bold rounded-lg truncate flex items-center justify-between transition-colors shadow-sm cursor-grab active:cursor-grabbing ${
                            ev.type === 'social' ? 'bg-amber-50 border border-amber-100 text-amber-800 hover:bg-amber-100' :
                            ev.type === 'music' ? 'bg-rose-50 border border-rose-100 text-rose-800 hover:bg-rose-100' :
                            ev.type === 'work' ? 'bg-slate-100 border border-slate-200 text-slate-800 hover:bg-slate-200' :
                            'bg-teal-50 border border-teal-100 text-teal-800 hover:bg-teal-100'
                          }`}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span>{ev.type === 'social' ? '🍻' : ev.type === 'music' ? '🎵' : ev.type === 'work' ? '💼' : '📌'}</span>
                            <span className="truncate">{ev.startTime ? `${ev.startTime} ` : ''}{ev.title}</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteEvent(ev.id);
                            }}
                            className="opacity-0 group-hover/evt:opacity-100 text-gray-400 hover:text-red-700 ml-1 font-black text-[10px] px-1 hover:bg-black/5 rounded transition-all"
                            title="Delete event"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add (+) Button indicator on hover */}
                    <div className="absolute right-1.5 top-1.5 p-0.5 rounded-full bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-600 shadow-sm pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                  </div>
                );
              })}

              {/* Scroll Down (Go Forward in Time) */}
              <button
                onClick={handleNext}
                className="col-span-7 py-2 bg-gray-50/50 hover:bg-blue-50/20 border-t border-gray-100 text-gray-400 hover:text-blue-600 flex items-center justify-center transition-colors cursor-pointer group"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transform group-hover:translate-y-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* MOBILE LIST VIEW */}
          <div className="md:hidden space-y-4">
            {/* Scroll Up Button for Mobile */}
            <button
              onClick={handlePrev}
              className="w-full py-2.5 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-blue-600 flex items-center justify-center shadow-sm active:scale-[0.99] transition-all cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
              </svg>
            </button>

            {calendarDates.map((dayDate, idx) => {
              const dateKey = getLocalDateKey(dayDate);
              const dayWeather = weather[dateKey];
              const { runs, gym, planned, custom, warnings, plannedGym } = getDayItems(dayDate);
              
              const isToday = getLocalDateKey(new Date()) === dateKey;
              const hasEvents = runs.length > 0 || gym.length > 0 || planned.length > 0 || custom.length > 0 || plannedGym.length > 0;

              // In 2-week view, list all days. In month view, only list days with events to save vertical space.
              if (viewMode === 'month' && !hasEvents) return null;

              return (
                <div 
                  key={idx} 
                  onClick={() => openAddEventModal(dayDate)}
                  className={`bg-white rounded-2xl border p-4 shadow-sm space-y-3 cursor-pointer active:scale-[0.99] transition-all ${
                    isToday ? 'border-blue-300 ring-2 ring-blue-50' : 'border-gray-100'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-sm font-black w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
                        isToday ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {dayDate.getDate()}
                      </span>
                      <span className="text-sm font-black text-gray-900">
                        {dayDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                      </span>
                    </div>

                    {dayWeather && (
                      <span className="text-xs font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">
                        {dayWeather.emoji} {dayWeather.temp}°
                      </span>
                    )}
                  </div>

                  {/* Card Warnings Alert */}
                  {warnings.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl text-amber-850 text-[11px] font-medium space-y-1">
                      <p className="font-black uppercase tracking-widest text-[9px] text-amber-900 flex items-center gap-1">
                        <span>🧠</span> AI Coach Warning
                      </p>
                      <ul className="list-disc ml-4 space-y-0.5 text-left">
                        {warnings.map((w, wIdx) => (
                          <li key={wIdx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Card Events List */}
                  {!hasEvents ? (
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic text-center py-1">No activities • Tap to plan event</p>
                  ) : (
                    <div className="space-y-2">
                      {runs.map(run => (
                        <div
                          key={run.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (run.id) window.location.href = `/runs/${run.id}`;
                          }}
                          className="p-3 text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span>🏃</span>
                            <span className="font-black uppercase tracking-tight">{run.runType} Run</span>
                          </div>
                          <span className="font-bold">{run.distance}km</span>
                        </div>
                      ))}

                      {gym.map(workout => (
                        <div
                          key={workout.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkout(workout);
                            setIsDrawerOpen(true);
                          }}
                          className="p-3 text-sm bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span>🏋️‍♂️</span>
                            <span className="font-black uppercase tracking-tight">Gym Workout</span>
                          </div>
                          <span className="font-bold capitalize">{workout.type}</span>
                        </div>
                      ))}

                      {planned.map(plannedItem => (
                        <div
                          key={plannedItem.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPlannedRun(plannedItem);
                          }}
                          className="p-3 text-sm bg-blue-50/50 border border-dashed border-blue-200 text-blue-800 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span>📅</span>
                            <span className="font-black uppercase tracking-tight">{plannedItem.workoutName}</span>
                          </div>
                          <span className="font-bold">{plannedItem.distance}</span>
                        </div>
                      ))}

                      {plannedGym.map(pg => (
                        <div
                          key={pg.id}
                          className="p-3 text-sm bg-indigo-50/50 border border-dashed border-indigo-200 text-indigo-800 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span>🏋️‍♂️</span>
                            <span className="font-black uppercase tracking-tight">Planned Gym</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold capitalize">{pg.type}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemovePlannedGym(pg.id, pg.date);
                              }}
                              className="text-red-500 hover:text-red-750 font-black text-sm px-2 py-0.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                              title="Remove this planned workout"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}

                      {custom.map(ev => (
                        <div
                          key={ev.id}
                          onClick={(e) => openEditEventModal(e, ev)}
                          className={`p-3 text-sm rounded-xl flex items-center justify-between border ${
                            ev.type === 'social' ? 'bg-amber-50 border-amber-100 text-amber-800' :
                            ev.type === 'music' ? 'bg-rose-50 border-rose-100 text-rose-800' :
                            ev.type === 'work' ? 'bg-slate-100 border-slate-200 text-slate-800' :
                            'bg-teal-50 border-teal-100 text-teal-800'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{ev.type === 'social' ? '🍻' : ev.type === 'music' ? '🎵' : ev.type === 'work' ? '💼' : '📌'}</span>
                            <span className="font-black uppercase tracking-tight">{ev.title}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {ev.startTime && <span className="font-bold">{ev.startTime}</span>}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEvent(ev.id);
                              }}
                              className="text-red-500 hover:text-red-750 font-black text-sm px-2 py-0.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                              title="Delete event"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Scroll Down Button for Mobile */}
            <button
              onClick={handleNext}
              className="w-full py-2.5 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-blue-600 flex items-center justify-center shadow-sm active:scale-[0.99] transition-all cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* --- ADD / EDIT CUSTOM EVENT MODAL --- */}
      {isEventModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-gray-100 transform scale-100 transition-all duration-300">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
              <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                {editingEventId ? 'Edit Event' : 'Add Custom Event'}
              </h3>
              <button onClick={closeEventModal} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Date</label>
                <input 
                  type="text" 
                  disabled
                  value={selectedDate ? selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : ''}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-xs font-bold text-gray-700 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Event Title</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Concert, Dinner, Drinks"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as 'social' | 'music' | 'work' | 'other')}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 bg-white"
                  >
                    <option value="social">🍻 Social / Drinks</option>
                    <option value="music">🎵 Music / Concert</option>
                    <option value="work">💼 Work / Meeting</option>
                    <option value="other">📌 Other Event</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Start Time</label>
                  <input 
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Description (Optional)</label>
                <textarea
                  placeholder="Additional details..."
                  rows={3}
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all shadow-md"
                >
                  Save Event
                </button>
                {editingEventId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(editingEventId)}
                    className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-black uppercase tracking-widest px-4 py-3 rounded-xl transition-all"
                  >
                    Delete
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- SLIDE-OUT DRAWER FOR GYM WORKOUT DETAILS --- */}
      {/* Backdrop */}
      {isDrawerOpen && (
        <div 
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] animate-in fade-in duration-300"
        />
      )}
      {/* Drawer Container */}
      <div className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[160] transition-transform duration-300 ease-out transform ${
        isDrawerOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedWorkout && (
          <div className="h-full flex flex-col p-6 overflow-y-auto">
            {/* Drawer Header */}
            <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-6">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                  Gym Workout
                </span>
                <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mt-1 capitalize">
                  {selectedWorkout.type} Routine
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                  {new Date(selectedWorkout.date).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold p-1 rounded-full hover:bg-gray-50 transition-colors"
              >
                ×
              </button>
            </div>

            {/* Exercises List */}
            <div className="flex-1 space-y-4">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-50 pb-1">
                Completed Exercises
              </h4>

              {Object.keys(selectedWorkout)
                .filter(k => !['id', 'date', 'type'].includes(k))
                .map(exerciseName => {
                  const exercise = selectedWorkout[exerciseName];
                  return (
                    <div key={exerciseName} className="bg-gray-50/50 border border-gray-100/80 rounded-2xl p-4 shadow-sm space-y-2">
                      <h5 className="text-xs font-black text-gray-800 uppercase tracking-tight">
                        {exerciseName}
                      </h5>
                      <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        <div className="bg-white p-2 rounded-xl border border-gray-50">
                          <span className="block text-[8px] text-gray-400 font-medium">Weight</span>
                          <span className="text-gray-800 font-black">{exercise.weight}</span>
                        </div>
                        <div className="bg-white p-2 rounded-xl border border-gray-50">
                          <span className="block text-[8px] text-gray-400 font-medium">Reps/Sets</span>
                          <span className="text-gray-800 font-black">{exercise.times}</span>
                        </div>
                        <div className="bg-white p-2 rounded-xl border border-gray-50">
                          <span className="block text-[8px] text-gray-400 font-medium">Reps Quality</span>
                          <span className="text-gray-800 font-black">{exercise.rating}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

              {Object.keys(selectedWorkout).filter(k => !['id', 'date', 'type'].includes(k)).length === 0 && (
                <p className="text-xs text-gray-400 italic text-center py-6">No exercises recorded for this workout.</p>
              )}
            </div>

            {/* Close Button at bottom */}
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="mt-6 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all"
            >
              Close Routine
            </button>
          </div>
        )}
      </div>

      {/* --- PLANNED RUN INSTRUCTION DETAILS MODAL --- */}
      {selectedPlannedRun && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-gray-100 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
              <div>
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                  Planned Run Instructions
                </span>
                <h3 className="text-base font-black text-gray-900 uppercase tracking-tight mt-1">
                  {selectedPlannedRun.workoutName}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedPlannedRun(null)} 
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 text-sm text-gray-600 font-medium leading-relaxed mb-6">
              <div className="grid grid-cols-2 gap-3 mb-4 bg-gray-50 p-3 rounded-2xl border border-gray-100 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <div>
                  <span className="block text-[8px] text-gray-400 font-medium">Target Distance</span>
                  <span className="text-gray-700 font-black text-xs">{selectedPlannedRun.distance}</span>
                </div>
                <div>
                  <span className="block text-[8px] text-gray-400 font-medium">Run Type</span>
                  <span className="text-gray-700 font-black text-xs">{selectedPlannedRun.runType}</span>
                </div>
              </div>

              <div className="prose prose-sm max-w-none text-gray-700 font-medium leading-relaxed">
                <ReactMarkdown
                  components={{
                    ul: ({...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                    ol: ({...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                    li: ({...props}) => <li className="pl-1" {...props} />,
                    p: ({...props}) => <p className="mb-2 last:mb-0" {...props} />,
                  }}
                >
                  {selectedPlannedRun.description || "No specific instructions provided for this training session."}
                </ReactMarkdown>
              </div>
            </div>

            <button
              onClick={() => setSelectedPlannedRun(null)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all shadow-md"
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
