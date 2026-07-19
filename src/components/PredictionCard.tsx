'use client';

import React, { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { RefreshCw, AlertCircle, Brain, ChevronDown, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface PredictionData {
  currentEstimate: string;
  probability: number;
  coachComment: string;
  detailedReasoning?: string;
  whatHasChanged?: string;
  lastUpdated?: string;
}

export default function PredictionCard() {
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrediction = React.useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        console.error("PredictionCard: No auth token available");
        setError("User not authenticated. Please refresh the page.");
        setLoading(false);
        return;
      }

      const method = forceRefresh ? 'POST' : 'GET';
      console.log(`PredictionCard: Fetching prediction via ${method}...`);
      
      const res = await fetch('/api/prediction', {
        method,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log(`PredictionCard: API Status ${res.status} ${res.statusText}`);
      
      if (res.ok) {
        const data = await res.json();
        console.log("PredictionCard: API Response Data:", data);
        
        // The POST endpoint returns { success: true, prediction: ... }
        // The GET endpoint returns prediction object directly
        const predData = (forceRefresh && data.prediction) ? data.prediction : data;
        
        if (predData && (predData.currentEstimate || predData.coachComment)) {
          console.log("PredictionCard: Received valid prediction data", predData.currentEstimate);
          setPrediction(predData);
          setError(null);
        } else {
          console.warn("PredictionCard: Received empty or invalid prediction data", data);
          if (!prediction) {
            setPrediction(null);
            setError("The AI returned an empty response. This might happen if your data is too sparse or the model is currently busy.");
          }
        }
      } else {
        const errText = await res.text();
        let errMessage = `Server Error (${res.status})`;
        let errDetails = "";
        try {
          const errJson = JSON.parse(errText);
          errMessage = errJson.error || errMessage;
          errDetails = errJson.details || "";
        } catch (e) {
          errMessage = errText.slice(0, 100) || errMessage;
        }
        console.error("PredictionCard: API Error Detail:", errMessage, errDetails);
        setError(errDetails ? `${errMessage} (${errDetails})` : errMessage);
      }
    } catch (err: any) {
      console.error("PredictionCard: Fetch Catch Block:", err);
      setError(`Connection Error: ${err.message || "Unknown error"}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchPrediction());
  }, [fetchPrediction]);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-pulse h-48 mb-8">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-6"></div>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="h-10 bg-gray-100 rounded"></div>
          <div className="h-10 bg-gray-100 rounded"></div>
        </div>
        <div className="h-4 bg-gray-100 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-100 rounded w-2/3"></div>
      </div>
    );
  }

  if (error || !prediction) {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 mb-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          {error ? <AlertCircle className="text-red-400 w-6 h-6" /> : <Brain className="text-blue-400 w-6 h-6" />}
        </div>
        <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-2">
          {error ? 'Prediction Error' : 'No Race Prediction'}
        </h3>
        <p className="text-sm text-gray-500 font-medium max-w-xs mb-4">
          {error || 'We need more data or a fresh analysis to predict your race performance.'}
        </p>
        
        // New: Detailed Error Helper
        {error && (
          <div className="mb-6 p-3 bg-red-50 rounded-lg border border-red-100 max-w-md">
            <p className="text-[10px] font-mono text-red-600 text-left overflow-auto whitespace-pre-wrap">
              {error.includes("default credentials") 
                ? "Primary Firebase Service Account is missing. Please add SERVICE_ACCOUNT_EMAIL and SERVICE_ACCOUNT_KEY to your .env.local file."
                : `Debug Info: ${error}`}
            </p>
          </div>
        )}

        <button
          onClick={() => fetchPrediction(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-blue-200"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Analyzing...' : 'Generate Prediction'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden group mb-8 transition-all hover:shadow-md">
      <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
        <span className="text-8xl font-black">🏁</span>
      </div>
      
      <div className="relative z-10">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              AI Race Predictor
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            </p>
            <button
              onClick={() => fetchPrediction(true)}
              disabled={refreshing}
              className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
          </div>
          <div className="px-3 py-1 bg-blue-50 rounded-full">
            <p className="text-[10px] font-black text-blue-600 uppercase">Target: Sub-47:30</p>
          </div>
        </div>

        {prediction.lastUpdated && (
          <p className="text-[9px] font-bold text-gray-300 uppercase mb-4">
            Last Updated: {new Date(prediction.lastUpdated).toLocaleString()}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="flex items-end gap-4">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Current 10K Fitness</p>
              <p className="text-5xl font-black text-gray-900 tracking-tighter">
                {prediction.currentEstimate}
              </p>
            </div>
            <div className="mb-1">
              <span className="text-xs font-bold text-gray-400 uppercase">Est. Time</span>
            </div>
          </div>
          
          <div className="flex flex-col md:items-end">
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-black text-gray-900">{prediction.probability}%</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Probability</p>
            </div>
            {/* Progress Bar */}
            <div className="mt-2 h-2 w-full md:w-48 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ease-out ${
                  prediction.probability > 75 ? 'bg-green-500' : 
                  prediction.probability > 50 ? 'bg-blue-500' : 
                  prediction.probability > 30 ? 'bg-orange-500' : 'bg-red-500'
                }`}
                style={{ width: `${prediction.probability}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div 
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-8 pt-6 border-t border-gray-100 flex gap-4 items-start cursor-pointer hover:bg-gray-50/50 transition-colors p-3 -m-3 rounded-xl group/insight"
        >
          <span className="text-2xl mt-1">🧠</span>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-wider">Coach&apos;s Insight</p>
              <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
            <div className="text-base font-bold text-gray-800 leading-snug">
              <ReactMarkdown
                components={{
                  ul: ({...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                  ol: ({...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                  li: ({...props}) => <li className="pl-1" {...props} />,
                  p: ({...props}) => <p className="mb-2 last:mb-0" {...props} />,
                }}
              >
                {prediction.coachComment}
              </ReactMarkdown>
            </div>
            
            {isExpanded && prediction.detailedReasoning && (
              <div className="mt-4 pt-4 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-300">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-widest">Full Explanation</p>
                <div className="text-sm font-medium text-gray-600 leading-relaxed prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      ul: ({...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                      ol: ({...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                      li: ({...props}) => <li className="pl-1" {...props} />,
                      p: ({...props}) => <p className="mb-3 last:mb-0" {...props} />,
                      strong: ({...props}) => <strong className="font-bold text-gray-800" {...props} />,
                    }}
                  >
                    {prediction.detailedReasoning}
                  </ReactMarkdown>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 flex items-start gap-2.5 bg-blue-50/50 p-3 rounded-lg border border-blue-100/50">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-gray-600 leading-relaxed w-full">
                    <strong className="text-gray-900 font-bold block mb-1">What has changed</strong>
                    {prediction.whatHasChanged ? (
                      <div className="text-sm font-medium text-gray-600 leading-relaxed prose prose-sm max-w-none">
                        <ReactMarkdown
                          components={{
                            ul: ({...props}) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                            ol: ({...props}) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                            li: ({...props}) => <li className="pl-1" {...props} />,
                            p: ({...props}) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({...props}) => <strong className="font-bold text-gray-800" {...props} />,
                          }}
                        >
                          {prediction.whatHasChanged}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-gray-500 italic">
                        No previous run comparison available yet. Upload a new run or refresh the prediction to analyze changes.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

