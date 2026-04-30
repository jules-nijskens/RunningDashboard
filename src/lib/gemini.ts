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
    let text = response.text().replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (error) {
    return { short: "Error connecting to coach.", long: "Failed to generate review." };
  }
}

export async function updateTrainingReport(currentReport: string, runData: Run) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) return currentReport;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `Update this report based on the new run if significant. Return ONLY text.\nREPORT: ${currentReport}\nNEW RUN: ${runData.date}, ${runData.distance}km, ${runData.averagePace}/km.`;

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

  const runsContext = recentRuns.map(r => 
    `- ${r.date}: ${r.runType}, ${r.distance}km, Pace: ${r.averagePace}, HR: ${r.averageHeartRate || 'N/A'}`
  ).join('\n');

  const prompt = `
    You are an expert running coach. Analyze this athlete's recent training to predict their current 10K fitness and the probability of hitting their goal.
    
    ATHLETE GOAL: ${userStats.goals?.join(', ') || "Sub-47:30 10K by August 1st"}
    STRATEGY REPORT: ${strategyReport}
    
    RECENT RUNS (Latest 20):
    ${runsContext}
    
    TASK:
    1. Estimate current 10K race time based on all runs (consider volume, consistency, and specific intensity sessions). Ignore old Personal Bests; focus strictly on what the recent data shows.
    2. Calculate probability (0-100) of hitting the primary goal by August 1st.
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
    let text = response.text().replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Prediction Error:", error);
    return null;
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
- If a hard workout is planned for tomorrow, and the athlete did a hard run today, intervene and suggest a rest or recovery day.

When asked about progress, data, or race predictions, use the "get_athlete_data" tool to see current status, including the latest race time prediction and the detailed reasoning behind it. Use this reasoning to provide consistent and data-backed advice.

STRATEGY UPDATES (IMPORTANT):
- If you identify information during the chat that is relevant for the long-term "Athlete Training Status & Strategy" report (e.g., a new injury, a change in schedule, or a performance breakthrough):
  1. Describe the proposed update to the athlete.
  2. Ask for their explicit confirmation to update the report.
  3. ONLY call the "update_strategy_report" tool AFTER the athlete has confirmed.
- To update the report, you MUST first use "get_athlete_data" to get the current content, then provide the full, revised text to "update_strategy_report".

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
