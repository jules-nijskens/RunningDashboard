import { NextResponse } from 'next/server';
import { getCoachModel } from '@/lib/gemini';
import { refreshPredictionData } from '@/lib/prediction';
import { adminDb, adminWorkoutsDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

// Helper to get athlete data for the coach (Using Admin DB)
async function getAthleteData(context?: { upcomingRuns?: any[], today?: string }) {
  const data: any = {
    stats: {},
    report: {},
    prediction: {},
    recentRuns: [],
    recentWorkouts: [],
    upcomingRuns: context?.upcomingRuns || [],
    today: context?.today || new Date().toISOString()
  };

  // Fetch user stats
  try {
    const statsSnap = await adminDb.doc('settings/user_stats').get();
    if (statsSnap.exists) data.stats = statsSnap.data();
  } catch (err) {
    console.warn("Coach: Could not fetch user_stats");
  }

  // Fetch training report
  try {
    const reportSnap = await adminDb.doc('settings/training_report').get();
    if (reportSnap.exists) data.report = reportSnap.data();
  } catch (err) {
    console.warn("Coach: Could not fetch training_report");
  }

  // Fetch race prediction
  try {
    const predSnap = await adminDb.doc('settings/prediction').get();
    if (predSnap.exists) data.prediction = predSnap.data();
  } catch (err) {
    console.warn("Coach: Could not fetch prediction");
  }

  // Fetch recent runs (last 10)
  try {
    const runsSnap = await adminDb.collection('runs')
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
    data.recentRuns = runsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn("Coach: Could not fetch runs");
  }

  // Fetch recent workouts (last 5)
  if (adminWorkoutsDb) {
    try {
      const workoutsSnap = await adminWorkoutsDb.collection('workouts')
        .orderBy('date', 'desc')
        .limit(5)
        .get();
      data.recentWorkouts = workoutsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn("Coach: Could not fetch workouts");
    }
  }

  return data;
}

export async function POST(request: Request) {
  try {
    // 0. Verify Auth
    await verifyAuth(request);

    const { messages, upcomingRuns, today } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Format history for Gemini SDK and strip leading 'model' messages
    let history = messages.slice(0, -1).map((m: any) => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    while (history.length > 0 && history[0].role === 'model') {
      history.shift();
    }

    const lastMessage = messages[messages.length - 1].content;

    const model = getCoachModel();
    const chat = model.startChat({
      history: history,
    });

    let result = await chat.sendMessage(lastMessage);
    let response = result.response;
    let call = response.functionCalls()?.[0];
    let needsPredictionUpdate = false;

    // Handle tool calls
    while (call) {
      let toolResponse;

      if (call.name === 'get_athlete_data') {
        toolResponse = await getAthleteData({ upcomingRuns, today });
      } else if (call.name === 'update_status') {
        const { status } = call.args as any;
        await adminDb.doc('settings/user_stats').set({
          status,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
        toolResponse = { status: `Training status updated to ${status} successfully.` };
        needsPredictionUpdate = true;
      } else if (call.name === 'update_strategy_report') {
        const { content } = call.args as any;
        await adminDb.doc('settings/training_report').set({
          content,
          lastUpdated: new Date().toISOString(),
          updatedBy: 'AI Coach'
        }, { merge: true });
        toolResponse = { status: 'Strategy report updated successfully.' };
        needsPredictionUpdate = true;
      } else if (call.name === 'update_goals') {
        const { goals } = call.args as any;
        await adminDb.doc('settings/user_stats').set({ goals }, { merge: true });
        toolResponse = { status: 'Goals updated successfully.' };
        needsPredictionUpdate = true;
      }

      result = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: toolResponse
        }
      }]);
      response = result.response;
      call = response.functionCalls()?.[0];
    }

    if (needsPredictionUpdate) {
      console.log("Coach: Triggering prediction refresh...");
      await refreshPredictionData();
    }

    return NextResponse.json({
      role: 'model',
      content: response.text()
    });
  } catch (error: any) {
    console.error('Coach API Error:', error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
