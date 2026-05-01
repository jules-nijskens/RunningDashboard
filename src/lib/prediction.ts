import { adminDb, adminWorkoutsDb } from './firebase-admin';
import { generatePrediction } from './gemini';

export async function refreshPredictionData() {
  console.log("Prediction: refreshPredictionData called");
  let userStats: any = {};
  let strategyReport: string = "No strategy report available.";
  let recentRuns: any[] = [];

  try {
    // 1. Fetch user stats (goals) using Admin DB
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
        return { id: doc.id, ...data };
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

    // 4. Generate prediction using Gemini
    let prediction: any = null;
    try {
      console.log("Prediction: Handing off to Gemini for analysis...");
      prediction = await generatePrediction(recentRuns, userStats, strategyReport);
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
