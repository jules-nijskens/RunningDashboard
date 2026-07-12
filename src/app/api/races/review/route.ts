import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    // 1. Verify Auth
    await verifyAuth(request);

    // 2. Parse request body
    const { race, run } = await request.json();
    if (!race || !run) {
      return NextResponse.json({ error: 'Missing race or run data.' }, { status: 400 });
    }

    // 3. Format Laps context
    const planLapsString = `Target Distance: ${race.targetDistance} km, Target Time: ${race.targetTime}`;
    const actualLapsString = run.laps?.map((l: any) => {
      let details = `Pace: ${l.avgPace}, HR: ${l.avgHR} bpm, Cadence: ${l.avgCadence} spm`;
      if (l.avgPower !== undefined) details += `, Power: ${l.avgPower} W`;
      if (l.avgStanceTime !== undefined) details += `, GCT: ${l.avgStanceTime} ms`;
      if (l.avgVerticalOscillation !== undefined) details += `, Vert Osc: ${l.avgVerticalOscillation} mm`;
      if (l.avgStepLength !== undefined) details += `, Stride: ${l.avgStepLength} mm`;
      return `Lap ${l.lapNumber}: ${l.distance} km in ${l.time} (${details})`;
    }).join('\n') || "No actual lap data.";

    // 4. Generate AI Post-Race Review
    const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key is offline.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `
      You are an expert running coach. Analyze the athlete's completed race performance by comparing their initial Race Plan (target targets, strategy) against the Actual Run telemetry parsed from their Garmin watch.
      
      RACE PLAN DETAILS:
      - Race Name: ${race.name}
      - Race Date: ${race.date}
      - Target Plan: ${planLapsString}
      - User's Planned Strategy Goals: ${race.strategyGoal || "None provided"}
      
      ACTUAL RUN PERFORMANCE:
      - Date: ${run.date}
      - Distance Completed: ${run.distance} km
      - Total Time: ${run.duration}
      - Average Pace: ${run.averagePace} /km
      - Average Heart Rate: ${run.averageHeartRate} bpm (Max HR: ${run.maxHeartRate} bpm)
      - Average Cadence: ${run.averageCadence} spm
      ${run.averagePower !== undefined ? `- Avg Power: ${run.averagePower} W (Max Power: ${run.maxPower} W)` : ''}
      ${run.averageGroundContactTime !== undefined ? `- Avg Ground Contact Time: ${run.averageGroundContactTime} ms` : ''}
      ${run.averageVerticalOscillation !== undefined ? `- Avg Vertical Oscillation: ${run.averageVerticalOscillation} cm` : ''}
      ${run.averageStrideLength !== undefined ? `- Avg Stride Length: ${run.averageStrideLength} m` : ''}
      - Notes: ${run.summary || "None provided"}
      
      ACTUAL LAP SPLITS:
      ${actualLapsString}
      
      INSTRUCTIONS:
      Write a comprehensive, professional, and insightful Post-Race Review in Markdown format. Use the following structured headings (use standard Markdown headers like ###):
      
      ### 1. Pacing & Split Execution
      * Compare the actual average pace against the planned target pace.
      * Did they execute their split strategy? Analyze the pacing profile across the laps (e.g. check if they faded in the latter half, started too fast, or executed a clean negative split).
      * Highlight their fastest and slowest laps.
      
      ### 2. Cardiovascular Strain & Heart Rate Profile
      * Evaluate their heart rate control. Did they experience excessive cardiac drift?
      * Comment on how close their average and max heart rates were to their Lactate Threshold (if LT info is available or implied).
      
      ### 3. Biomechanics & Form Trends
      * Analyze their running dynamics across the laps (if GCT, vertical oscillation, cadence, or stride length are available).
      * Note if their cadence dropped or if GCT increased as they fatigued in the later laps.
      * Comment on stride length and power output consistency across laps.
      
      ### 4. Overall Assessment & Key Lessons
      * Give a summary evaluation (e.g., A-grade execution, solid effort, pacing lesson).
      * Praise the athlete on what went well.
      * Provide 2-3 specific, actionable recommendations for their next block of training or race.
      
      Maintain an encouraging, analytical, and highly technical coaching tone. Write direct, specific observations based on the numbers, avoiding generic encouragement.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const review = response.text();

    return NextResponse.json({ review });
  } catch (error: any) {
    console.error('Race review generation failed:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate post-race review.' }, { status: 500 });
  }
}
