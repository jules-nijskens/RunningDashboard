import { NextResponse } from 'next/server';
import { getCoachModel } from '@/lib/gemini';
import { refreshPredictionData } from '@/lib/prediction';
import { adminDb, adminWorkoutsDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

// Helper to get athlete data for the coach (Using Admin DB)
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function getAthleteData(context?: { upcomingRuns?: any[], customEvents?: any[], today?: string, includeFullPlan?: boolean, raceId?: string }) {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const data: any = {
    stats: {},
    report: {},
    prediction: {},
    recentRuns: [],
    recentWorkouts: [],
    upcomingRuns: [], // Will be populated below
    customEvents: [], // Will be populated below
    activeRace: null,
    today: context?.today || new Date().toISOString()
  };

  // Fetch active race context if specified
  if (context?.raceId) {
    try {
      const raceSnap = await adminDb.doc(`races/${context.raceId}`).get();
      if (raceSnap.exists) {
        data.activeRace = { id: raceSnap.id, ...raceSnap.data() };
      }
    } catch (err) {
      console.warn("Coach: Could not fetch active race details:", err);
    }
  }

  // 1. Fetch user stats (includes coachingMode)
  try {
    const statsSnap = await adminDb.doc('settings/user_stats').get();
    if (statsSnap.exists) {
      data.stats = statsSnap.data();
    }
  } catch (err) {
    console.warn("Coach: Could not fetch user_stats");
  }

  const coachingMode = data.stats.coachingMode || 'runna';

  // 2. Populate Upcoming Runs based on mode
  if (coachingMode === 'runna') {
    const runs = context?.upcomingRuns || [];
    data.upcomingRuns = context?.includeFullPlan ? runs : runs.slice(0, 10);
  } else {
    try {
      // Fetch from gemini_plans for Gemini mode
      const todayStr = (context?.today || new Date().toISOString()).split('T')[0];
      let plansQuery = adminDb.collection('gemini_plans')
        .where('date', '>=', todayStr)
        .orderBy('date', 'asc');
      
      // Limit to 10 unless full plan requested
      if (!context?.includeFullPlan) {
        plansQuery = plansQuery.limit(10);
      }

      const plansSnap = await plansQuery.get();
      
      data.upcomingRuns = plansSnap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          summary: `${d.runType} • ${d.distance}`,
          description: d.description,
          start: { date: d.date }
        };
      });
    } catch (err) {
      console.warn("Coach: Could not fetch gemini_plans", err);
    }
  }

  // 2.5. Fetch upcoming custom events from database (limit 15)
  try {
    const todayStr = (context?.today || new Date().toISOString()).split('T')[0];
    const customSnap = await adminDb.collection('custom_events')
      .where('date', '>=', todayStr)
      .orderBy('date', 'asc')
      .limit(15)
      .get();
    data.customEvents = customSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        date: d.date,
        startTime: d.startTime || '',
        title: d.title,
        type: d.type,
        description: d.description || ''
      };
    });
  } catch (err) {
    console.warn("Coach: Could not fetch custom_events from database", err);
    data.customEvents = context?.customEvents || [];
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

    const { messages, upcomingRuns, customEvents, today, raceId } = await request.json();

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
        const { includeFullPlan } = call.args as any;
        toolResponse = await getAthleteData({ upcomingRuns, customEvents, today, includeFullPlan, raceId });
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
      } else if (call.name === 'generate_training_plan') {
        const { plan } = call.args as any;
        
        // Batch write to gemini_plans
        const batch = adminDb.batch();
        const plansCol = adminDb.collection('gemini_plans');
        
        // 1. Delete future plans to avoid overlaps
        const todayStr = new Date().toISOString().split('T')[0];
        const futurePlans = await plansCol.where('date', '>=', todayStr).get();
        futurePlans.docs.forEach(doc => batch.delete(doc.ref));
        
        // 2. Add new plans
        plan.forEach((workout: any) => {
          const docRef = plansCol.doc();
          batch.set(docRef, {
            ...workout,
            createdAt: new Date().toISOString()
          });
        });
        
        await batch.commit();
        toolResponse = { status: `Training plan with ${plan.length} workouts generated and saved successfully.` };
      } else if (call.name === 'update_race_strategy') {
        const { content } = call.args as any;
        if (raceId) {
          await adminDb.doc(`races/${raceId}`).update({
            coachPreview: content
          });
          toolResponse = { status: 'Race strategy successfully updated with the revised version.' };
        } else {
          toolResponse = { error: 'No active race context found to update.' };
        }
      } else if (call.name === 'update_race_review') {
        const { content } = call.args as any;
        if (raceId) {
          await adminDb.doc(`races/${raceId}`).update({
            postRaceReview: content
          });
          toolResponse = { status: 'Race review successfully updated with the revised version.' };
        } else {
          toolResponse = { error: 'No active race context found to update.' };
        }
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
