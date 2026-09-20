import { adminDb, adminWorkoutsDb } from './firebase-admin';
import { generatePrediction, RaceData } from './gemini';
import { Run } from '@/types/run';

interface EFDetails {
  currentEF: number | null;
  efTrendPercent: number;
  runsAnalyzedCount: number;
  runs: { date: string; distance: number; runType: string; ef: number }[];
}

interface PredictionResult {
  currentEstimate: string;
  probability: number;
  coachComment: string;
  detailedReasoning?: string;
  whatHasChanged?: string;
  targetDistance?: string;
  targetTime?: string;
  efTrendPercent?: number | null;
}

function parseDurationToSeconds(duration: string): number {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function calculateRunEF(run: Run): number | null {
  if (!run.averageHeartRate || run.averageHeartRate <= 0 || !run.distance || !run.duration) {
    return null;
  }
  
  let totalSeconds = parseDurationToSeconds(run.duration);
  let totalDistance = run.distance;
  
  // Apply watch-stop tail filtering: exclude last lap if distance < 0.15 km (150m)
  if (run.laps && run.laps.length > 1) {
    const lastLap = run.laps[run.laps.length - 1];
    if (lastLap.distance && lastLap.distance < 0.15 && lastLap.time) {
      const lastLapSeconds = parseDurationToSeconds(lastLap.time);
      totalSeconds = Math.max(0, totalSeconds - lastLapSeconds);
      totalDistance = Math.max(0, totalDistance - lastLap.distance);
      console.log(`Excluding watch-stop tail for run ${run.id}: ${lastLap.distance}km in ${lastLap.time}`);
    }
  }
  
  if (totalSeconds <= 0 || totalDistance <= 0) return null;
  
  const durationInMinutes = totalSeconds / 60;
  const speedMPerMin = (totalDistance * 1000) / durationInMinutes;
  
  return parseFloat((speedMPerMin / run.averageHeartRate).toFixed(3));
}

function getDaysAgoDateString(baseDate: Date, daysAgo: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function refreshPredictionData() {
  console.log("Prediction: refreshPredictionData called");
  let userStats: any = {};
  let strategyReport: string = "No strategy report available.";
  let recentRuns: Run[] = [];

  try {
    // 1. Fetch user stats (goals, trainingMode) using Admin DB
    try {
      console.log("Prediction: Fetching settings/user_stats...");
      const statsSnap = await adminDb.doc('settings/user_stats').get();
      userStats = statsSnap.exists ? statsSnap.data() : {};
      console.log("Prediction: userStats exists:", statsSnap.exists, "Goals count:", userStats?.goals?.length || 0);
    } catch (e: any) {
      console.error("Prediction Error: Fetching user_stats failed", e.message);
      throw new Error(`Failed to fetch user stats: ${e.message}`);
    }

    // 2. Fetch training report
    try {
      console.log("Prediction: Fetching settings/training_report...");
      const reportSnap = await adminDb.doc('settings/training_report').get();
      strategyReport = reportSnap.exists ? reportSnap.data()?.content : "No strategy report available.";
      console.log("Prediction: trainingReport exists:", reportSnap.exists, "Report length:", strategyReport.length);
    } catch (e: any) {
      console.error("Prediction Error: Fetching training_report failed", e.message);
      throw new Error(`Failed to fetch training report: ${e.message}`);
    }

    // 3. Fetch latest 20 runs
    try {
      console.log("Prediction: Querying 'runs' collection...");
      const runsSnap = await adminDb.collection('runs')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();
      
      console.log("Prediction: 'runs' query returned", runsSnap.size, "documents.");
      
      recentRuns = runsSnap.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, ...data } as Run;
      });
      
      if (recentRuns.length > 0) {
        console.log(`Prediction: First run ID: ${recentRuns[0].id}, Date: ${recentRuns[0].date}, Distance: ${recentRuns[0].distance}km`);
      } else {
        console.warn("Prediction: NO RUNS FOUND in 'runs' collection.");
      }
    } catch (e: any) {
      console.error("Prediction Error: Fetching runs failed", e.message);
      throw new Error(`Failed to fetch runs: ${e.message}`);
    }

    // 3.5 Fetch previous prediction (if any) to compare
    let previousPrediction: any = null;
    try {
      console.log("Prediction: Fetching settings/prediction for comparison...");
      const prevSnap = await adminDb.doc('settings/prediction').get();
      if (prevSnap.exists) {
        previousPrediction = prevSnap.data();
        console.log("Prediction: Loaded previous prediction for comparison", previousPrediction.currentEstimate);
      }
    } catch (e: any) {
      console.warn("Prediction: Could not fetch previous prediction", e.message);
    }

    // 3.7 Fetch upcoming races
    let upcomingRaces: RaceData[] = [];
    try {
      console.log("Prediction: Fetching upcoming races...");
      const todayStr = new Date().toISOString().split('T')[0];
      const racesSnap = await adminDb.collection('races')
        .where('date', '>=', todayStr)
        .orderBy('date', 'asc')
        .get();
      upcomingRaces = racesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RaceData));
      console.log(`Prediction: Found ${upcomingRaces.length} upcoming races.`);
    } catch (e: any) {
      console.warn("Prediction: Could not fetch upcoming races:", e.message);
    }

    // Check training focus mode
    const trainingMode = userStats.trainingMode || 'race';
    console.log("Prediction: Current training mode:", trainingMode);

    let efDetails: EFDetails | null = null;

    if (trainingMode === 'building') {
      // Calculate EF for easy/long runs
      const easyRunsWithEF = recentRuns
        .filter(r => r.runType === 'Easy' || r.runType === 'Long Run')
        .map(r => ({
          id: r.id,
          date: r.date,
          distance: r.distance,
          duration: r.duration,
          averageHeartRate: r.averageHeartRate,
          runType: r.runType,
          ef: calculateRunEF(r)
        }))
        .filter(r => r.ef !== null);

      const today = new Date();
      const todayStr = getDaysAgoDateString(today, 0);
      const last7dStartStr = getDaysAgoDateString(today, 6); // 7-day window: [today-6, today]
      const preceding7dEndStr = getDaysAgoDateString(today, 7); // Prior 7-day window: [today-13, today-7]
      const preceding7dStartStr = getDaysAgoDateString(today, 13);

      const runsLast7Days = easyRunsWithEF.filter(r => r.date >= last7dStartStr && r.date <= todayStr);
      const runsPreceding7Days = easyRunsWithEF.filter(r => r.date >= preceding7dStartStr && r.date <= preceding7dEndStr);

      const avgEFLast7Days = runsLast7Days.length > 0
        ? runsLast7Days.reduce((acc, curr) => acc + curr.ef!, 0) / runsLast7Days.length
        : null;

      const avgEFPreceding7Days = runsPreceding7Days.length > 0
        ? runsPreceding7Days.reduce((acc, curr) => acc + curr.ef!, 0) / runsPreceding7Days.length
        : null;

      let currentEF = avgEFLast7Days;
      if (currentEF === null) {
        // Fallback: use all easy runs from the last 20 runs
        currentEF = easyRunsWithEF.length > 0
          ? easyRunsWithEF.reduce((acc, curr) => acc + curr.ef!, 0) / easyRunsWithEF.length
          : null;
      }

      let efTrendPercent = 0;
      if (currentEF !== null && avgEFPreceding7Days !== null && avgEFPreceding7Days > 0) {
        efTrendPercent = parseFloat((((currentEF - avgEFPreceding7Days) / avgEFPreceding7Days) * 100).toFixed(1));
      }

      efDetails = {
        currentEF: currentEF !== null ? parseFloat(currentEF.toFixed(3)) : null,
        efTrendPercent,
        runsAnalyzedCount: easyRunsWithEF.length,
        runs: easyRunsWithEF.map(r => ({ date: r.date, distance: r.distance, runType: r.runType, ef: r.ef as number }))
      };

      console.log(`Prediction: Calculated Building Mode EF details. Current EF: ${efDetails.currentEF}, Trend: ${efDetails.efTrendPercent}%`);
    }

    // 4. Generate prediction using Gemini
    let prediction: PredictionResult | null = null;
    try {
      console.log("Prediction: Handing off to Gemini for analysis...");
      prediction = await generatePrediction(
        recentRuns, 
        userStats, 
        strategyReport, 
        previousPrediction, 
        upcomingRaces,
        trainingMode,
        efDetails || undefined
      );
    } catch (e: any) {
      console.error("Prediction Error: Gemini generation failed", e.message);
      throw new Error(`AI Analysis failed: ${e.message}`);
    }

    if (prediction) {
      console.log("Prediction: Gemini analysis successful. Est:", prediction.currentEstimate);
      
      // 5. Save to Firestore using Admin DB
      try {
        console.log("Prediction: Saving to settings/prediction...");
        await adminDb.doc('settings/prediction').set({
          ...prediction,
          efTrendPercent: efDetails?.efTrendPercent ?? null,
          lastUpdated: new Date().toISOString()
        });
        console.log("Prediction: Firestore save complete!");
      } catch (e: any) {
        console.error("Prediction Error: Saving result failed", e.message);
        throw new Error(`Failed to save prediction to database: ${e.message}`);
      }
      return prediction;
    } else {
      console.error("Prediction: Gemini analysis failed (returned null).");
      throw new Error("Gemini returned null. Check your API key or model quota.");
    }
  } catch (err: any) {
    console.error("Prediction: CRITICAL ERROR in refreshPredictionData:", err.message);
    throw err; // Re-throw to be caught by the API route
  }
}
