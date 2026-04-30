import { adminDb, adminWorkoutsDb } from './firebase-admin';
import { generatePrediction } from './gemini';

export async function refreshPredictionData() {
  try {
    // 1. Fetch user stats (goals) using Admin DB
    const statsSnap = await adminDb.doc('settings/user_stats').get();
    const userStats = statsSnap.exists ? statsSnap.data() : {};

    // 2. Fetch training report
    const reportSnap = await adminDb.doc('settings/training_report').get();
    const strategyReport = reportSnap.exists ? reportSnap.data()?.content : "No strategy report available.";

    // 3. Fetch latest 20 runs
    const runsSnap = await adminDb.collection('runs')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    
    const recentRuns = runsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

    // 4. Generate prediction using Gemini
    const prediction = await generatePrediction(recentRuns, userStats, strategyReport);

    if (prediction) {
      // 5. Save to Firestore using Admin DB
      await adminDb.doc('settings/prediction').set({
        ...prediction,
        lastUpdated: new Date().toISOString()
      });
      return prediction;
    }
  } catch (err) {
    console.error("Error refreshing prediction:", err);
  }
  return null;
}
