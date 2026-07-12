import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(request: Request) {
  try {
    // 1. Verify Auth
    await verifyAuth(request);

    // 2. Parse request body
    const { name, date, targetDistance, targetTime, strategyGoal } = await request.json();
    if (!name || !date || !targetDistance || !targetTime) {
      return NextResponse.json({ error: 'Missing required race fields.' }, { status: 400 });
    }

    // 3. Fetch user physiological stats
    let userStats: any = {};
    try {
      const statsSnap = await adminDb.doc('settings/user_stats').get();
      if (statsSnap.exists) {
        userStats = statsSnap.data();
      }
    } catch (err) {
      console.error("Failed to fetch user stats for race preview:", err);
    }

    const healthPerformanceContext = `
      - VO2 Max: ${userStats.performance?.vo2max || 'N/A'}
      - Lactate Threshold: ${userStats.performance?.thresholdPace || 'N/A'} @ ${userStats.performance?.thresholdHR || 'N/A'} bpm
      - HRV (7d Avg): ${userStats.health?.hrv7d || 'N/A'} ms
      - Resting HR: ${userStats.health?.rhr || 'N/A'} bpm
      - Sleep (7d Avg Score): ${userStats.health?.sleep || 'N/A'}
    `;

    // 4. Generate Pre-Race Strategy
    const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key is offline.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `
      You are an expert running coach. Write a detailed, highly specific, and professional Pre-Race Strategy & Pacing Guide for an athlete who is preparing for an upcoming race.
      
      RACE DETAILS:
      - Name: ${name}
      - Date: ${date}
      - Target Distance: ${targetDistance} km
      - Target Finish Time: ${targetTime}
      - Athlete's Strategy Notes & Goals: ${strategyGoal || "None provided"}
      
      ATHLETE PHYSIOLOGICAL CONTEXT:
      ${healthPerformanceContext}
      
      INSTRUCTIONS:
      Write a comprehensive guide in Markdown format. Use the following structured headings (use standard Markdown headers like ###):
      
      ### 1. Pacing Strategy & Splits
      * Calculate the average target pace in min/km (e.g. for a ${targetDistance}k in ${targetTime}).
      * Propose a pacing strategy (e.g. Negative Split, Even Split, or Positive Split depending on the distance).
      * Provide a split breakdown. You MUST present this split breakdown as a clean Markdown table with headers: "Distance (km)", "Split Target Time (Cumulative)", and "Target Lap Pace". Make splits relevant to the distance (e.g., every 1K for 5K/10K, every 5K for half/full marathons).
      
      ### 2. Fueling & Hydration (Pre & In-Race)
      * Give a nutrition timeline leading up to the race (carbo-loading, morning-of meal).
      * Outline in-race carbohydrate (gels, chews) and hydration intake targets (ml/hour or per km/mile).
      
      ### 3. Final Tapering Advice
      * Outline volume and intensity adjustments for the final 3-7 days.
      * Include advice on sleep, mobility, and mental preparation.
      
      ### 4. Tactical Advice & Adjustments
      * Give tips on course management (hills, turns, wind) and shoe choice.
      * Outline how to adjust pacing if the weather turns hot (>20°C) or windy.
      
      Keep the tone encouraging, highly expert, punchy, and customized to their physiological indicators (e.g. reference their Lactate Threshold or Sleep quality if relevant). Do not use generic filler text.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const preview = response.text();

    return NextResponse.json({ preview });
  } catch (error: any) {
    console.error('Race preview generation failed:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate race strategy preview.' }, { status: 500 });
  }
}
