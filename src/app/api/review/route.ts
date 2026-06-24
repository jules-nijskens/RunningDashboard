import { NextResponse } from 'next/server';
import { generateRunReview, updateTrainingReport } from '@/lib/gemini';
import { refreshPredictionData } from '@/lib/prediction';
import { adminDb, adminWorkoutsDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

async function getCoordinates(location: string) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`, {
      headers: {
        'User-Agent': 'RunningDashboard/1.0'
      }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: data[0].lat,
        lon: data[0].lon
      };
    }
  } catch (err) {
    console.error("Geocoding failed:", err);
  }
  return null;
}

async function getWeather(dateStr: string, lat: string, lon: string, time?: string) {
  try {
    const date = new Date(dateStr).toISOString().split('T')[0];
    
    if (time) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.hourly) {
        const hour = parseInt(time.split(':')[0]);
        const temp = data.hourly.temperature_2m[hour];
        const rain = data.hourly.precipitation[hour];
        const wind = data.hourly.wind_speed_10m[hour];
        const humidity = data.hourly.relative_humidity_2m[hour];
        
        return `${temp}°C, Humidity: ${humidity}%, Rain: ${rain}mm, Wind: ${wind}km/h (at ${time})`;
      }
    }

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=auto`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.daily) {
      const max = data.daily.temperature_2m_max[0];
      const min = data.daily.temperature_2m_min[0];
      const rain = data.daily.precipitation_sum[0];
      const wind = data.daily.windspeed_10m_max[0];
      return `${max}°C / ${min}°C, Rain: ${rain}mm, Wind: ${wind}km/h`;
    }
  } catch (err) {
    console.error("Weather lookup failed:", err);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    // 0. Verify Auth
    await verifyAuth(request);

    const runData = await request.json();

    // 1. Fetch current strategy report & user stats (Using Admin DB)
    let currentReport = "";
    let userStats: any = {};
    try {
      const [reportSnap, statsSnap] = await Promise.all([
        adminDb.doc('settings/training_report').get(),
        adminDb.doc('settings/user_stats').get()
      ]);
      
      if (reportSnap.exists) {
        currentReport = reportSnap.data()?.content || "";
      }
      if (statsSnap.exists) {
        userStats = statsSnap.data();
      }
    } catch (err) {
      console.error("Fetch stats/report failed:", err);
    }

    // 2. Look up weather automatically
    const location = runData.location || "Oranienburg, DE";
    const coords = await getCoordinates(location);
    
    if (coords) {
      const autoWeather = await getWeather(runData.date, coords.lat, coords.lon, runData.time);
      if (autoWeather) {
        runData.weather = autoWeather;
      }
    }

    // 3. Fetch Recent Activities (Last 7 Days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentRuns: any[] = [];
    try {
      const runsSnap = await adminDb.collection('runs')
        .where('timestamp', '>=', sevenDaysAgo.getTime())
        .orderBy('timestamp', 'desc')
        .get();
      
      runsSnap.forEach(doc => {
        const data = doc.data();
        if (data.date !== runData.date || data.distance !== runData.distance) {
          recentRuns.push(data);
        }
      });
    } catch (err) {
      console.error("Fetch recent runs failed:", err);
    }

    const recentWorkouts: any[] = [];
    if (adminWorkoutsDb) {
      try {
        const workoutsSnap = await adminWorkoutsDb.collection('workouts')
          .where('date', '>=', sevenDaysAgo) // Admin SDK handles Date objects
          .orderBy('date', 'desc')
          .get();
        workoutsSnap.forEach(doc => {
          recentWorkouts.push(doc.data());
        });
      } catch (err) {
        console.error("Fetch recent workouts failed:", err);
      }
    }

    // 3.5. Fetch Upcoming Runs based on mode
    let upcomingRuns = runData.upcomingRuns || [];
    const coachingMode = userStats.coachingMode || 'runna';
    
    if (coachingMode === 'gemini') {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const plansSnap = await adminDb.collection('gemini_plans')
          .where('date', '>=', todayStr)
          .orderBy('date', 'asc')
          .limit(3)
          .get();
        
        upcomingRuns = plansSnap.docs.map(doc => {
          const d = doc.data();
          return {
            summary: `${d.runType} • ${d.distance}`,
            start: { date: d.date }
          };
        });
      } catch (err) {
        console.warn("Review: Could not fetch gemini_plans for context", err);
      }
    }

    // 3.6. Fetch Upcoming Custom Life Events
    let customEvents: { date: string; startTime?: string; title: string; type: string; description?: string }[] = [];
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const customSnap = await adminDb.collection('custom_events')
        .where('date', '>=', todayStr)
        .orderBy('date', 'asc')
        .limit(5)
        .get();
      customEvents = customSnap.docs.map(docSnap => {
        const d = docSnap.data();
        return {
          date: d.date || '',
          startTime: d.startTime,
          title: d.title || '',
          type: d.type || '',
          description: d.description
        };
      });
    } catch (err) {
      console.warn("Review: Could not fetch custom_events for context", err);
    }

    // 4. Generate Review
    const review = await generateRunReview(runData, currentReport, {
      recentRuns,
      recentWorkouts,
      upcomingRuns,
      customEvents,
      userStats
    });

    // 5. Update Report & Status
    if (currentReport) {
      const { report: updatedReport, status: updatedStatus } = await updateTrainingReport(currentReport, runData, userStats);
      
      const reportChanged = updatedReport && updatedReport.trim() !== currentReport.trim();
      const statusChanged = updatedStatus && updatedStatus !== userStats.status;

      if (reportChanged) {
        await adminDb.doc('settings/training_report').set({ 
          content: updatedReport,
          lastUpdated: new Date().toISOString(),
          updatedBy: 'AI Coach'
        }, { merge: true });
      }

      if (statusChanged) {
        await adminDb.doc('settings/user_stats').set({ 
          status: updatedStatus,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }
    }

    // 6. Trigger prediction update
    try {
      await refreshPredictionData();
    } catch (err) {
      console.warn("Prediction update failed after upload:", err);
    }

    return NextResponse.json({ review, weather: runData.weather });
  } catch (error: any) {
    console.error("API Route Error:", error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
