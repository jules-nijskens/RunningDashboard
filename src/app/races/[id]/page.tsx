'use client';

import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, collection, query, where, orderBy, limit, getDocs, addDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Race, Run } from '@/types/run';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dynamic from 'next/dynamic';
import GeminiCoach from '@/components/GeminiCoach';
import { Trophy, Calendar, Target, Clock, Sparkles, Loader2, Link as LinkIcon, ChevronRight, BarChart2 } from 'lucide-react';

const RunMap = dynamic(() => import('@/components/RunMap'), {
  ssr: false,
  loading: () => <div className="w-full h-[350px] bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 font-medium animate-pulse">Loading map...</div>
});

export default function RaceDetail() {
  const params = useParams();
  const router = useRouter();
  
  const [race, setRace] = useState<Race | null>(null);
  const [linkedRun, setLinkedRun] = useState<Run | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPreRace, setShowPreRace] = useState(false);

  useEffect(() => {
    if (!params.id) return;

    // 1. Listen to real-time changes on the Race Document
    const raceRef = doc(db, 'races', params.id as string);
    const unsubscribeRace = onSnapshot(raceRef, async (raceSnap) => {
      if (!raceSnap.exists()) {
        setError("Race not found.");
        setLoading(false);
        return;
      }

      const raceData = { id: raceSnap.id, ...raceSnap.data() } as Race;
      setRace(raceData);

      // 2. Fetch linked run details if completed
      if (raceData.status === 'completed' && raceData.linkedRunId) {
        try {
          const runSnap = await getDoc(doc(db, 'runs', raceData.linkedRunId));
          if (runSnap.exists()) {
            setLinkedRun({ id: runSnap.id, ...runSnap.data() } as Run);
          }
        } catch (err) {
          console.error("Error loading linked run:", err);
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Real-time race load error:", err);
      setError("Failed to load details. Check connection.");
      setLoading(false);
    });

    // 3. Fetch list of recent runs for linking (one-time)
    const fetchRecentRuns = async () => {
      try {
        const runsQuery = query(
          collection(db, 'runs'),
          orderBy('timestamp', 'desc'),
          limit(15)
        );
        const runsSnap = await getDocs(runsQuery);
        const runsList: Run[] = [];
        runsSnap.forEach((docSnap) => {
          runsList.push({ id: docSnap.id, ...docSnap.data() } as Run);
        });
        setRecentRuns(runsList);
      } catch (err) {
        console.error("Error loading recent runs:", err);
      }
    };

    fetchRecentRuns();

    return () => unsubscribeRace();
  }, [params.id]);

  const handleLinkRun = async () => {
    if (!selectedRunId || !race) return;

    setLinking(true);
    setError(null);

    try {
      // 1. Get the run details from Firestore
      const runRef = doc(db, 'runs', selectedRunId);
      const runSnap = await getDoc(runRef);
      if (!runSnap.exists()) {
        throw new Error("Selected run activity not found.");
      }
      const runData = { id: runSnap.id, ...runSnap.data() } as Run;

      // 2. Call AI post-race review endpoint
      const token = await auth.currentUser?.getIdToken();
      const reviewRes = await fetch('/api/races/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ race, run: runData })
      });

      if (!reviewRes.ok) {
        const errData = await reviewRes.json();
        throw new Error(errData.error || 'AI Coach review generation failed.');
      }

      const { review } = await reviewRes.json();

      // 3. Create Chat History for post-race review discussion
      let reviewChatId = "";
      try {
        const chatRef = await addDoc(collection(db, 'chats'), {
          timestamp: Date.now(),
          title: `Race Review: ${race.name}`,
          messages: [
            { role: 'user', content: `I just completed my race: ${race.name}! Target was ${race.targetDistance} km in ${race.targetTime}. Here is my actual run data.` },
            { role: 'model', content: review }
          ]
        });
        reviewChatId = chatRef.id;
      } catch (chatError) {
        console.error("Failed to create review chat history:", chatError);
      }

      // 4. Update the Race document in Firestore
      const raceRef = doc(db, 'races', race.id!);
      await updateDoc(raceRef, {
        linkedRunId: selectedRunId,
        status: 'completed',
        postRaceReview: review,
        reviewChatId
      });

      // 5. Update local state
      setRace(prev => prev ? { ...prev, status: 'completed', linkedRunId: selectedRunId, postRaceReview: review, reviewChatId } : null);
      setLinkedRun(runData);
    } catch (err: any) {
      console.error("Failed to link run to race:", err);
      setError(err.message || "Failed to link activity and perform AI review.");
    } finally {
      setLinking(false);
    }
  };

  const handleOpenChat = (chatId: string) => {
    sessionStorage.setItem('openReviewChatId', chatId);
    window.dispatchEvent(new Event('openReviewChat'));
  };

  if (loading) return <div className="text-center py-20 text-gray-500 font-medium">Loading race comparison...</div>;
  if (error || !race) return <div className="text-center py-20 text-red-500 font-bold">{error || "Race not found."}</div>;

  // Helper to calculate target splits / average pace
  // Convert target time (e.g. "03:45:00" or "47:30") to pace min/km
  const getTargetPace = () => {
    try {
      const timeParts = race.targetTime.split(':').map(Number);
      let totalSeconds = 0;
      if (timeParts.length === 3) {
        totalSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
      } else if (timeParts.length === 2) {
        totalSeconds = timeParts[0] * 60 + timeParts[1];
      }
      
      if (totalSeconds > 0 && race.targetDistance > 0) {
        const paceSec = totalSeconds / race.targetDistance;
        const minutes = Math.floor(paceSec / 60);
        const seconds = Math.floor(paceSec % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
      }
    } catch (e) {
      console.warn("Could not calculate target pace", e);
    }
    return '--:--/km';
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <button 
          onClick={() => router.back()}
          className="mb-6 flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors text-sm"
        >
          ← Back to Dashboard
        </button>

        {/* Top Header Card */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden mb-8 border border-gray-100">
          <div className={`p-8 text-white ${race.status === 'completed' ? 'bg-gradient-to-r from-green-600 to-teal-600' : 'bg-gradient-to-r from-blue-600 to-indigo-600'}`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <span className="text-xs font-black uppercase tracking-widest bg-white/20 px-2.5 py-1 rounded-md">
                  🥇 {race.status === 'completed' ? 'Completed Race' : 'Planned Race'}
                </span>
                <h1 className="text-3xl font-black mt-3">{race.name}</h1>
                <p className="opacity-90 text-sm mt-1 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" /> {race.date}
                </p>
              </div>
              <div className="text-left sm:text-right bg-white/10 p-4 rounded-xl backdrop-blur-sm min-w-[150px]">
                <p className="text-[10px] uppercase font-black tracking-wider opacity-75">Target Finish</p>
                <p className="text-2xl font-black">{race.targetTime}</p>
                <p className="text-xs opacity-90 mt-1 font-bold">{race.targetDistance} km • {getTargetPace()}</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            {/* COMPARATIVE SECTION IF COMPLETED */}
            {race.status === 'completed' && linkedRun && (
              <div className="mb-10">
                <h2 className="text-sm font-black text-gray-800 mb-4 uppercase tracking-widest flex items-center gap-1.5">
                  <BarChart2 className="w-4 h-4 text-blue-600" />
                  Target vs. Actual Metrics
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 text-center">
                    <p className="text-gray-500 text-xs font-black uppercase tracking-wider">Distance</p>
                    <div className="flex justify-center items-baseline gap-2 mt-2">
                      <span className="text-2xl font-black text-gray-900">{linkedRun.distance} km</span>
                      <span className="text-xs text-gray-400 font-bold">/ {race.targetDistance} km</span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold mt-1">Completed GPS Track</p>
                  </div>

                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 text-center">
                    <p className="text-gray-500 text-xs font-black uppercase tracking-wider">Finish Time</p>
                    <div className="flex justify-center items-baseline gap-2 mt-2">
                      <span className="text-2xl font-black text-blue-600">{linkedRun.duration}</span>
                      <span className="text-xs text-gray-400 font-bold">/ {race.targetTime}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold mt-1">Total Timer Duration</p>
                  </div>

                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 text-center">
                    <p className="text-gray-500 text-xs font-black uppercase tracking-wider">Average Pace</p>
                    <div className="flex justify-center items-baseline gap-2 mt-2">
                      <span className="text-2xl font-black text-gray-900">{linkedRun.averagePace}/km</span>
                      <span className="text-xs text-gray-400 font-bold">/ {getTargetPace()}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold mt-1">Watch Pace</p>
                  </div>
                </div>
              </div>
            )}

            {/* ROUTE MAP IF COMPLETED */}
            {race.status === 'completed' && linkedRun?.routeCoordinates && linkedRun.routeCoordinates.length > 0 && (
              <div className="mb-10">
                <h2 className="text-sm font-black text-gray-800 mb-4 uppercase tracking-widest">Race Route Track</h2>
                <RunMap coordinates={linkedRun.routeCoordinates} />
              </div>
            )}

            {/* POST-RACE AI REVIEW */}
            {race.status === 'completed' && race.postRaceReview && (
              <div className="mb-10">
                <h2 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-tight flex items-center gap-2">
                  <span className="bg-green-600 text-white text-[10px] px-2 py-1 rounded-md">AI</span>
                  Post-Race Performance Analysis
                </h2>
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-8 rounded-2xl text-gray-100 shadow-xl border-l-4 border-green-500">
                  <div className="text-base leading-relaxed font-medium prose prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        ul: ({node, ...props}) => <ul className="list-disc ml-6 mb-4 space-y-2" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal ml-6 mb-4 space-y-2" {...props} />,
                        li: ({node, ...props}) => <li className="pl-1" {...props} />,
                        p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                        table: ({node, ...props}) => <table className="min-w-full divide-y divide-gray-200 border-2 border-gray-100 rounded-xl my-4 overflow-hidden" {...props} />,
                        thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                        tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-100" {...props} />,
                        tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
                        th: ({node, ...props}) => <th className="px-4 py-2 text-left text-xs font-black text-gray-700 uppercase tracking-widest" {...props} />,
                        td: ({node, ...props}) => <td className="px-4 py-2.5 text-sm text-gray-900 font-bold animate-in fade-in" {...props} />,
                      }}
                    >
                      {race.postRaceReview}
                    </ReactMarkdown>
                    {race.reviewChatId && (
                      <button
                        onClick={() => handleOpenChat(race.reviewChatId!)}
                        className="mt-6 inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md gap-2 active:scale-95 cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        Discuss Review with Coach
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* LINK RUN INTERFACE IF PLANNED */}
            {race.status === 'planned' && (
              <div className="bg-blue-50/70 p-6 rounded-2xl border border-blue-100/50 mb-10 shadow-sm">
                <h3 className="text-md font-black text-blue-900 uppercase tracking-tight flex items-center gap-2">
                  <LinkIcon className="w-4 h-4" />
                  Link Completed Activity
                </h3>
                <p className="text-sm text-gray-600 mt-1 mb-4">Select the watch run representing this race. The AI Coach will analyze your target plan splits against your actual watch telemetry.</p>
                
                <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                  <select
                    value={selectedRunId}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    className="flex-1 p-3 border-2 border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:border-blue-600 focus:outline-none bg-white shadow-sm"
                    disabled={linking}
                  >
                    <option value="">-- Choose uploaded run --</option>
                    {recentRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.date} • {r.runType} • {r.distance} km • {r.duration}
                      </option>
                    ))}
                  </select>
                  
                  <button
                    onClick={handleLinkRun}
                    disabled={linking || !selectedRunId}
                    className={`px-6 py-3 font-bold rounded-xl text-white shadow-sm text-sm active:scale-95 transition-all flex items-center justify-center gap-2 min-w-[160px] ${
                      linking || !selectedRunId ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {linking ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      'Link and Analyze'
                    )}
                  </button>
                </div>
                {error && <p className="text-red-600 text-xs font-bold mt-2">{error}</p>}
              </div>
            )}

            {/* PRE-RACE STRATEGY (COLLAPSED FOR COMPLETED) */}
            {race.coachPreview && (
              <div>
                {race.status === 'completed' ? (
                  <div className="border border-gray-100 rounded-2xl overflow-hidden mt-6 shadow-sm">
                    <button
                      onClick={() => setShowPreRace(!showPreRace)}
                      className="w-full bg-gray-50 hover:bg-gray-100 p-5 font-black text-gray-800 flex justify-between items-center transition-colors text-sm uppercase tracking-wider"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-500" />
                        View Pre-Race Strategy Plan
                      </span>
                      <ChevronRight className={`w-4 h-4 transition-transform ${showPreRace ? 'rotate-90' : ''}`} />
                    </button>
                    {showPreRace && (
                      <div className="p-6 bg-white border-t border-gray-100 text-gray-700 leading-relaxed font-medium prose max-w-none text-sm">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            ul: ({node, ...props}) => <ul className="list-disc ml-6 mb-4 space-y-2" {...props} />,
                            ol: ({node, ...props}) => <ol className="list-decimal ml-6 mb-4 space-y-2" {...props} />,
                            li: ({node, ...props}) => <li className="pl-1" {...props} />,
                            p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                            table: ({node, ...props}) => <table className="min-w-full divide-y divide-gray-200 border-2 border-gray-100 rounded-xl my-4 overflow-hidden" {...props} />,
                            thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                            tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-100" {...props} />,
                            tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
                            th: ({node, ...props}) => <th className="px-4 py-2 text-left text-xs font-black text-gray-700 uppercase tracking-widest" {...props} />,
                            td: ({node, ...props}) => <td className="px-4 py-2.5 text-sm text-gray-900 font-bold animate-in fade-in" {...props} />,
                          }}
                        >
                          {race.coachPreview}
                        </ReactMarkdown>
                        {race.strategyChatId && (
                          <button
                            onClick={() => handleOpenChat(race.strategyChatId!)}
                            className="mt-6 inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md gap-2 active:scale-95 cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4" />
                            Discuss Strategy with Coach
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <h2 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-tight flex items-center gap-2">
                      <span className="bg-blue-600 text-white text-[10px] px-2 py-1 rounded-md">AI</span>
                      Pre-Race Strategy Guide
                    </h2>
                    <div className="bg-blue-50/50 p-8 border border-blue-100 rounded-2xl text-gray-700 leading-relaxed font-medium prose max-w-none shadow-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          ul: ({node, ...props}) => <ul className="list-disc ml-6 mb-4 space-y-2" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal ml-6 mb-4 space-y-2" {...props} />,
                          li: ({node, ...props}) => <li className="pl-1" {...props} />,
                          p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                          table: ({node, ...props}) => <table className="min-w-full divide-y divide-gray-200 border-2 border-gray-100 rounded-xl my-4 overflow-hidden" {...props} />,
                          thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                          tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-100" {...props} />,
                          tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
                          th: ({node, ...props}) => <th className="px-4 py-2 text-left text-xs font-black text-gray-700 uppercase tracking-widest" {...props} />,
                          td: ({node, ...props}) => <td className="px-4 py-2.5 text-sm text-gray-900 font-bold animate-in fade-in" {...props} />,
                        }}
                      >
                        {race.coachPreview}
                      </ReactMarkdown>
                      {race.strategyChatId && (
                        <button
                          onClick={() => handleOpenChat(race.strategyChatId!)}
                          className="mt-6 inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md gap-2 active:scale-95 cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4" />
                          Discuss Strategy with Coach
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <GeminiCoach activeRaceId={race.id} />
    </main>
  );
}
