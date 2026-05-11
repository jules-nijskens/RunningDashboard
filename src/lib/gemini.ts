import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { Run, Workout } from "@/types/run";

export async function generateRunReview(
  runData: Run, 
  trainingReport?: string,
  context?: { recentRuns: Run[], recentWorkouts: Workout[], upcomingRuns?: any[] }
) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  
  if (!apiKey) {
    return {
      short: "Coach is offline.",
      long: "Gemini API key is missing."
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const lapsString = runData.laps?.map(l => 
    `Lap ${l.lapNumber}: ${l.distance}km in ${l.time} (Pace: ${l.avgPace}, HR: ${l.avgHR})`
  ).join('\n') || "No lap data.";

  const recentRunsContext = context?.recentRuns.map(r => 
    `- ${r.date}: ${r.runType}, ${r.distance}km, Pace: ${r.averagePace}`
  ).join('\n') || "None.";

  const recentWorkoutsContext = context?.recentWorkouts.map(w => {
    const date = w.date?.toDate ? w.date.toDate().toLocaleDateString() : 'Unknown';
    return `- ${date} (${w.type}): ${Object.keys(w).filter(k => !['id','date','type'].includes(k)).join(', ')}`;
  }).join('\n') || "None.";

  const upcomingRunsContext = context?.upcomingRuns?.map(u => 
    `- ${u.start?.dateTime || u.start?.date}: ${u.summary}`
  ).join('\n') || "None scheduled.";

  const prompt = `
    You are an expert running coach for an 194cm athlete. August 1st Goal: Sub-47:30 10K.
    
    STRATEGY: ${trainingReport || "N/A"}
    RECENT HISTORY (7 Days):
    Runs: ${recentRunsContext}
    Gym: ${recentWorkoutsContext}

    UPCOMING PLANNED RUNS:
    ${upcomingRunsContext}

    CURRENT RUN:
    - Date: ${runData.date}, ${runData.weather || "Unknown Weather"}
    - Metrics: ${runData.distance}km, ${runData.duration}, ${runData.averagePace}/km, ${runData.averageHeartRate}bpm, ${runData.averageCadence}spm
    - Notes: ${runData.summary}
    - Laps: ${lapsString}
    
    Review this run. Be punchy. Take upcoming runs into account (e.g. if a hard run is next, suggest extra recovery).
    
    RETURN ONLY JSON:
    { "short": "max 12 words", "long": "3-4 sentences" }
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Run Review Error:", error);
    return { short: "Error connecting to coach.", long: "Failed to generate review." };
  }
}

export async function updateTrainingReport(currentReport: string, runData: Run) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) return currentReport;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `
    You are an expert running coach updating an athlete's "Training Status & Strategy" report.
    
    The report MUST always follow this exact 4-header structure:
    1. Current Training Phase & Objectives
    2. Physiological Status & Fitness
    3. Biomechanics & Form Trends
    4. Short-Term Strategy (Next 2-3 Weeks)

    NEW DATA TO INTEGRATE:
    Run on ${runData.date}: ${runData.distance}km, ${runData.averagePace}/km, ${runData.averageHeartRate || 'N/A'}bpm.
    Athlete Notes: ${runData.summary || "None"}

    TASK:
    - Update the existing report content based on this new run if it contains significant insights (e.g., new PBs, signs of fatigue, biomechanical improvements, or changes in short-term focus).
    - Maintain all long-term context that is still relevant.
    - If no significant update is needed for a specific section, keep it as is.
    - RETURN THE FULL UPDATED REPORT TEXT.
    - DO NOT change the header names or numbering.

    CURRENT REPORT:
    ${currentReport}
  `;

  try {
    const result = await model.generateContent(prompt);
    return (await result.response).text().trim();
  } catch {
    return currentReport;
  }
}

export async function generatePrediction(
  recentRuns: Run[],
  userStats: any,
  strategyReport: string
) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const runsContext = recentRuns.length > 0 
    ? recentRuns.map(r => `- ${r.date}: ${r.runType}, ${r.distance}km, Pace: ${r.averagePace}, HR: ${r.averageHeartRate || 'N/A'}`).join('\n')
    : "No recent runs available.";

  console.log(`Gemini: Generating prediction. Runs context length: ${runsContext.length} chars.`);

  const prompt = `
    You are an expert running coach. Analyze this athlete's recent training to predict their current 10K fitness and the probability of hitting their goal.
    
    ATHLETE GOAL: ${userStats.goals?.join(', ') || "Sub-47:30 10K by August 1st"}
    STRATEGY REPORT: ${strategyReport}
    
    RECENT RUNS (Latest 20):
    ${runsContext}
    
    IMPORTANT: You MUST provide an estimate even if the run history is sparse. Base it on the athlete's goals, strategy report, and any available metrics.
    
    TASK:
    1. Estimate current 10K race time based on all available data (volume, consistency, and specific intensity sessions).
    2. Calculate probability (0-100) of hitting the primary goal.
    3. Provide a brief, punchy coach insight (max 25 words).
    4. Provide a detailed reasoning (2-3 paragraphs) explaining the data points, trends, and specific runs that led to this prediction.
    
    RETURN ONLY JSON:
    {
      "currentEstimate": "MM:SS",
      "probability": number,
      "coachComment": "string",
      "detailedReasoning": "string"
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("Gemini: No JSON found in response. Response text:", text);
      throw new Error("No JSON found in response");
    }
    const parsed = JSON.parse(jsonMatch[0]);
    console.log("Gemini: Successfully generated prediction:", parsed.currentEstimate);
    return parsed;
  } catch (error) {
    console.error("Prediction Error:", error);
    // Return a fallback prediction instead of null to avoid hiding the card
    return {
      currentEstimate: "--:--",
      probability: 50,
      coachComment: "I'm having trouble analyzing your data right now. Check back in a moment.",
      detailedReasoning: "The AI analysis encountered an error. This usually happens when the model is overloaded or the data structure is unexpected."
    };
  }
}

// --- NEW COACH CHAT CAPABILITIES ---

export const COACH_SYSTEM_INSTRUCTION = `
You are "The Coach", a world-class running and strength coach for a tall athlete (194cm).
You are direct, motivating, and data-driven.
You have access to the athlete's full history, including runs, gym workouts, and long-term strategy.
Your goal is to help the athlete reach their goals (currently Sub-47:30 10K by August 1st).

CONTEXTUAL AWARENESS:
- Always consider "today's date" (provided in the data) when giving advice.
- Review past runs (history) to see if the athlete is under or over-training.
- Review upcoming runs (planned schedule) to help the athlete prepare for what's next.

ATHLETE TRAINING STATUS & STRATEGY REPORT (IMPORTANT):
When updating the strategy report, you MUST strictly adhere to this 4-header structure:
1. Current Training Phase & Objectives
2. Physiological Status & Fitness
3. Biomechanics & Form Trends
4. Short-Term Strategy (Next 2-3 Weeks)

STRATEGY UPDATES:
- If you identify information during the chat that is relevant for the long-term report (e.g., a new injury, a change in schedule, or a performance breakthrough):
  1. Describe the proposed update to the athlete.
  2. Ask for their explicit confirmation to update the report.
  3. ONLY call the "update_strategy_report" tool AFTER the athlete has confirmed.
- To update the report, you MUST first use "get_athlete_data" to get the current content, then provide the full, revised text using the exact 4-header structure to "update_strategy_report".

If the athlete wants to change their primary goals, use "update_goals".

Be concise but thorough. Use emojis sparingly but effectively 🏃‍♂️🏋️‍♂️.
`;

export const coachTools: any[] = [
  {
    functionDeclarations: [
      {
        name: "get_athlete_data",
        description: "Get the athlete's current goals, PBs, strategy report, and recent activities (runs/workouts).",
      },
      {
        name: "update_strategy_report",
        description: "Update the long-term 'Athlete Training Status & Strategy' report.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            content: { type: SchemaType.STRING, description: "The full updated text of the report." }
          },
          required: ["content"]
        }
      },
      {
        name: "update_goals",
        description: "Update the list of current goals for the athlete.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            goals: { 
              type: SchemaType.ARRAY, 
              items: { type: SchemaType.STRING }, 
              description: "New list of goal strings." 
            }
          },
          required: ["goals"]
        }
      }
    ]
  }
];

export function getCoachModel() {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ 
    model: "gemini-flash-latest",
    systemInstruction: COACH_SYSTEM_INSTRUCTION,
    tools: coachTools
  });
}
