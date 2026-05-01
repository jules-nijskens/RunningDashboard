import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { generatePrediction } from '@/lib/gemini';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    // 1. Fetch user stats
    const statsSnap = await adminDb.doc('settings/user_stats').get();
    const userStats = statsSnap.exists ? statsSnap.data() : { note: "Not found" };

    // 2. Fetch training report
    const reportSnap = await adminDb.doc('settings/training_report').get();
    const strategyReport = reportSnap.exists ? reportSnap.data()?.content : "Not found";

    // 3. Fetch latest 20 runs
    const runsSnap = await adminDb.collection('runs')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    
    const recentRuns = runsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({
      dataCounts: {
        runs: recentRuns.length,
        hasStats: statsSnap.exists,
        hasReport: reportSnap.exists
      },
      sampleRun: recentRuns[0] || null,
      userStats,
      strategyReportSummary: strategyReport.slice(0, 100) + "..."
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
