'use client';

import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { collection, addDoc, doc, getDoc, onSnapshot, updateDoc, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Run, RunType, Lap } from '@/types/run';

const RUN_TYPES: RunType[] = ['Easy', 'Long Run', 'Tempo', 'Interval', 'Race', 'Time Trial'];

interface GarminCSVRow {
  'Laps'?: string;
  'Date'?: string;
  'Activity Type'?: string;
  'Distance km'?: string;
  'Distance'?: string;
  'Time'?: string;
  'Duration'?: string;
  'Avg Pace min/km'?: string;
  'Avg Pace'?: string;
  'Avg Moving Pace min/km'?: string;
  'Calories C'?: string;
  'Calories'?: string;
  'Avg HR bpm'?: string;
  'Avg HR'?: string;
  'Max HR bpm'?: string;
  'Max HR'?: string;
  'Avg Run Cadence spm'?: string;
  'Avg Cadence'?: string;
  [key: string]: string | undefined;
}

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRunData, setParsedRunData] = useState<Partial<Run> | null>(null);
  const [runType, setRunType] = useState<RunType>('Easy');
  const [summary, setSummary] = useState('');
  const [runDate, setRunDate] = useState(new Date().toISOString().split('T')[0]);
  const [runTime, setRunTime] = useState("09:00");
  const [location, setLocation] = useState('Oranienburg, DE');
  const [forestPercentage, setForestPercentage] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [coachingMode, setCoachingMode] = useState<'runna' | 'gemini'>('runna');
  const [shoes, setShoes] = useState<{ id: string; name: string }[]>([]);
  const [selectedShoeId, setSelectedShoeId] = useState<string>('');

  const determineDefaultShoe = (type: RunType, shoesList: { id: string; name: string }[]) => {
    const kayano = shoesList.find(s => s.name.toLowerCase().includes('kayano'));
    const superblast = shoesList.find(s => s.name.toLowerCase().includes('superblast'));

    if (type === 'Easy' || type === 'Long Run') {
      return kayano ? kayano.id : (shoesList[0]?.id || '');
    } else {
      return superblast ? superblast.id : (shoesList[0]?.id || '');
    }
  };

  const handleRunTypeChange = (newType: RunType) => {
    setRunType(newType);
    if (shoes.length > 0) {
      setSelectedShoeId(determineDefaultShoe(newType, shoes));
    }
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'user_stats'), (docSnap) => {
      if (docSnap.exists()) {
        setCoachingMode(docSnap.data().coachingMode || 'runna');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchShoes = async () => {
      try {
        const snap = await getDocs(collection(db, 'shoes'));
        const shoeList: { id: string; name: string }[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          shoeList.push({ id: docSnap.id, name: data.name });
        });
        setShoes(shoeList);
        
        if (shoeList.length > 0) {
          setSelectedShoeId(determineDefaultShoe(runType, shoeList));
        }
      } catch (err) {
        console.error("Failed to load shoes in upload form:", err);
      }
    };
    fetchShoes();
  }, []);

  const fetchUpcomingRuns = async () => {
    if (coachingMode === 'gemini') return [];
    
    const token = sessionStorage.getItem('google_calendar_token');
    const calendarId = process.env.NEXT_PUBLIC_TRAINING_CALENDAR_ID;
    if (!token || !calendarId) return [];

    try {
      const timeMin = new Date().toISOString();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=3`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        return data.items || [];
      }
    } catch (err) {
      console.error("Failed to fetch upcoming runs for context:", err);
    }
    return [];
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setParsedRunData(null);
      setIsUploading(true);
      setMessage(null);

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/parse-fit', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to parse FIT file.');
        }

        const parsed = await res.json() as Partial<Run>;
        setParsedRunData(parsed);

        // Pre-populate date/time if available
        if (parsed.date) setRunDate(parsed.date);
        if (parsed.time) setRunTime(parsed.time);

        setMessage({ type: 'success', text: 'FIT file uploaded and parsed successfully!' });
      } catch (err: any) {
        console.error("Error uploading/parsing FIT file:", err);
        setMessage({ type: 'error', text: err.message || 'Failed to process FIT file.' });
        setFile(null);
        if (e.target) e.target.value = '';
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !parsedRunData) {
      setMessage({ type: 'error', text: 'Please select a valid FIT file first.' });
      return;
    }

    setIsUploading(true);
    setMessage(null);

    try {
      // Fetch user goal from settings
      let userGoal = "";
      try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'user_stats'));
        if (settingsSnap.exists()) {
          userGoal = settingsSnap.data().goal || "";
        }
      } catch (goalError) {
        console.error("Failed to fetch user goal:", goalError);
      }

      const selectedShoe = shoes.find(s => s.id === selectedShoeId);

      const newRun: Run = {
        ...parsedRunData,
        runType,
        summary,
        location,
        userGoal,
        shoeId: selectedShoeId || undefined,
        shoeName: selectedShoe ? selectedShoe.name : undefined,
        surfacePercentages: {
          forestTrail: forestPercentage,
          bikingPath: 100 - forestPercentage
        },
        // Apply overrides if user modified them in form
        date: runDate,
        time: runTime,
        timestamp: new Date(`${runDate}T${runTime}`).getTime(),
      } as Run;

      // Generate AI Review
      try {
        const upcomingRuns = await fetchUpcomingRuns();
        const token = await auth.currentUser?.getIdToken();
        
        const reviewRes = await fetch('/api/review', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ ...newRun, upcomingRuns }),
        });
        if (reviewRes.ok) {
          const { review } = await reviewRes.json();
          newRun.coachReview = review.long;
          newRun.coachReviewShort = review.short;
          newRun.aiDescription = review.structure;
        }
      } catch (aiError) {
        console.error("AI Review failed:", aiError);
      }

      await addDoc(collection(db, 'runs'), newRun);
      
      if (selectedShoeId && newRun.distance) {
        try {
          const shoeRef = doc(db, 'shoes', selectedShoeId);
          const shoeSnap = await getDoc(shoeRef);
          if (shoeSnap.exists()) {
            const currentDist = shoeSnap.data().currentDistance || 0;
            await updateDoc(shoeRef, {
              currentDistance: parseFloat((currentDist + newRun.distance).toFixed(2))
            });
          }
        } catch (shoeUpdateError) {
          console.error("Failed to increment shoe mileage:", shoeUpdateError);
        }
      }
      
      if (newRun.coachReview) {
        try {
          const runTitle = `${newRun.runType} Run - ${newRun.distance}km`;
          const chatRef = await addDoc(collection(db, 'chats'), {
            timestamp: Date.now(),
            title: `Review: ${runTitle}`,
            messages: [
              { role: 'user', content: `I just uploaded a new ${runTitle} completed in ${newRun.duration}. Could you analyze it?` },
              { role: 'model', content: newRun.coachReview }
            ]
          });
          // Store the ID so the dashboard can open it automatically
          sessionStorage.setItem('openReviewChatId', chatRef.id);
        } catch (chatError) {
          console.error("Failed to create chat history for run review:", chatError);
        }
      }
      
      setMessage({ type: 'success', text: 'Run with advanced metrics and route uploaded successfully!' });
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
      setFile(null);
      setParsedRunData(null);
      setSummary('');
      
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error: unknown) {
      console.error('Error uploading run:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to upload run.';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setIsUploading(false);
    }
  };


  return (
    <div className="bg-white p-8 rounded-2xl shadow-xl border-2 border-gray-100 mb-8">
      <h2 className="text-2xl font-black text-gray-900 mb-6 border-b pb-4 tracking-tight">Upload New Run</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
            <label className="block text-xs font-black text-blue-800 uppercase tracking-widest mb-3">Garmin FIT File</label>
            <input
              id="file-upload"
              type="file"
              accept=".fit"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2.5 file:px-6
                file:rounded-xl file:border-0
                file:text-sm file:font-black
                file:bg-blue-600 file:text-white
                hover:file:bg-blue-700 transition-all
                cursor-pointer"
              required
            />
          </div>
          <div className="bg-purple-50 p-5 rounded-xl border border-purple-100 shadow-sm">
            <label className="block text-xs font-black text-purple-800 uppercase tracking-widest mb-3">Run Date</label>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="date"
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 focus:outline-none bg-white shadow-inner"
                required
              />
              <input
                type="time"
                value={runTime}
                onChange={(e) => setRunTime(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 focus:outline-none bg-white shadow-inner"
                required
              />
            </div>
          </div>
          <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
            <label className="block text-xs font-black text-blue-800 uppercase tracking-widest mb-3">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, Country"
              className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-inner"
              required
            />
          </div>
        </div>

        <div className="bg-orange-50 p-5 rounded-xl border border-orange-100 shadow-sm">
          <label className="block text-xs font-black text-orange-800 uppercase tracking-widest mb-3">Run Type</label>
          <select
            value={runType}
            onChange={(e) => handleRunTypeChange(e.target.value as RunType)}
            className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 focus:outline-none bg-white shadow-inner appearance-none"
          >
            {RUN_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
          <label className="block text-xs font-black text-blue-800 uppercase tracking-widest mb-3">Shoe Used</label>
          <select
            value={selectedShoeId}
            onChange={(e) => setSelectedShoeId(e.target.value)}
            className="w-full p-3 border-2 border-gray-300 rounded-xl text-lg font-bold text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white shadow-inner"
          >
            <option value="">-- No Shoe --</option>
            {shoes.map(shoe => (
              <option key={shoe.id} value={shoe.id}>{shoe.name}</option>
            ))}
          </select>
        </div>

        {/* Terrain Slider */}
        <div className="bg-green-50 p-5 rounded-xl border border-green-100 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <label className="block text-xs font-black text-green-800 uppercase tracking-widest">Terrain Mix</label>
            <div className="flex gap-4 text-[10px] font-black uppercase tracking-tighter">
              <span className="text-blue-600">🚲 Path: {100 - forestPercentage}%</span>
              <span className="text-green-700">🌲 Trail: {forestPercentage}%</span>
            </div>
          </div>
          <div className="relative h-6 flex items-center">
            <input
              type="range"
              min="0"
              max="100"
              value={forestPercentage}
              onChange={(e) => setForestPercentage(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
            />
          </div>
          <div className="flex justify-between mt-2 px-1">
            <span className="text-[10px] font-bold text-blue-500 uppercase">🚲 Biking Path</span>
            <span className="text-[10px] font-bold text-green-600 uppercase">🌲 Forest Trail</span>
          </div>
        </div>

        <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
          <label className="block text-xs font-black text-gray-800 uppercase tracking-widest mb-3">Jules&apos; Notes</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full p-4 border-2 border-gray-300 rounded-xl text-lg font-medium text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white shadow-inner min-h-[120px]"
            placeholder="How did the run feel? Any specific pains or breakthroughs?"
          />
        </div>

        <button
          type="submit"
          disabled={isUploading || !file}
          className={`w-full py-4 px-6 rounded-xl text-white font-black text-lg shadow-lg transition-all active:scale-95 ${
            isUploading || !file ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-200'
          }`}
        >
          {isUploading ? 'Generating AI Review...' : 'Upload & Analyze Run'}
        </button>

        {message && (
          <div className={`p-4 rounded-xl text-center font-bold shadow-sm ${message.type === 'success' ? 'bg-green-100 text-green-800 border-2 border-green-200' : 'bg-red-100 text-red-800 border-2 border-red-200'}`}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}
