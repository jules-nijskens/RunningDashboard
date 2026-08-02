import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { Run, Workout } from "@/types/run";

export async function generateRunReview(
  runData: Run, 
  trainingReport?: string,
  context?: { 
    recentRuns: Run[]; 
    recentWorkouts: Workout[]; 
    upcomingRuns?: { start?: { dateTime?: string; date?: string }; summary?: string }[]; 
    customEvents?: { date: string; startTime?: string; title: string; type: string; description?: string }[]; 
    userStats?: {
      performance?: { vo2max?: number | string; thresholdPace?: string; thresholdHR?: number | string };
      health?: { hrv7d?: number | string; hrvStatus?: string; rhr7d?: number | string; sleep?: number | string };
    };
  }
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

  const lapsString = runData.laps?.map(l => {
    let details = `Pace: ${l.avgPace}, HR: ${l.avgHR}, Cadence: ${l.avgCadence}`;
    if (l.avgPower !== undefined) details += `, Power: ${l.avgPower}W`;
    if (l.avgStanceTime !== undefined) details += `, GCT: ${l.avgStanceTime}ms`;
    if (l.avgVerticalOscillation !== undefined) details += `, Vert Osc: ${l.avgVerticalOscillation}mm`;
    if (l.avgStepLength !== undefined) details += `, Stride: ${l.avgStepLength}mm`;
    if (l.avgTemperature !== undefined) details += `, Temp: ${l.avgTemperature}°C`;
    return `Lap ${l.lapNumber}: ${l.distance}km in ${l.time} (${details})`;
  }).join('\n') || "No lap data.";

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

  const customEventsContext = context?.customEvents?.map(c =>
    `- ${c.date}${c.startTime ? ` @ ${c.startTime}` : ''}: ${c.title} (${c.type})${c.description ? ` - ${c.description}` : ''}`
  ).join('\n') || "None scheduled.";

  const userStats = context?.userStats || {};
  const healthPerformanceContext = `
    - VO2 Max: ${userStats.performance?.vo2max || 'N/A'}
    - Lactate Threshold: ${userStats.performance?.thresholdPace || 'N/A'} @ ${userStats.performance?.thresholdHR || 'N/A'} bpm
    - HRV (7d Avg): ${userStats.health?.hrv7d || 'N/A'} ms
    - HRV Status: ${userStats.health?.hrvStatus || 'N/A'}
    - Resting HR (7d Avg): ${userStats.health?.rhr7d || 'N/A'} bpm
    - Sleep (7d Avg Score): ${userStats.health?.sleep || 'N/A'}
  `;

  const prompt = `
    You are an expert running coach for an 194cm athlete. August 1st Goal: Sub-47:30 10K.
    Today's Date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
    
    STRATEGY: ${trainingReport || "N/A"}
    PHYSIOLOGICAL CONTEXT: ${healthPerformanceContext}
    RECENT HISTORY (7 Days):
    Runs: ${recentRunsContext}
    Gym: ${recentWorkoutsContext}

    UPCOMING PLANNED RUNS:
    ${upcomingRunsContext}

    UPCOMING LIFE EVENTS (Concerts, Drinks, Social, Work):
    ${customEventsContext}

    CURRENT RUN:
    - Type: ${runData.runType}
    - Date: ${runData.date}, ${runData.weather || "Unknown Weather"}
    - Metrics: ${runData.distance}km, ${runData.duration}, ${runData.averagePace}/km, ${runData.averageHeartRate}bpm, ${runData.averageCadence}spm
    ${runData.averagePower !== undefined ? `- Avg Power: ${runData.averagePower}W (Max Power: ${runData.maxPower}W)` : ''}
    ${runData.averageGroundContactTime !== undefined ? `- Avg Ground Contact Time: ${runData.averageGroundContactTime}ms` : ''}
    ${runData.averageVerticalOscillation !== undefined ? `- Avg Vertical Oscillation: ${runData.averageVerticalOscillation}cm` : ''}
    ${runData.averageStrideLength !== undefined ? `- Avg Stride Length: ${runData.averageStrideLength}m` : ''}
    - Notes: ${runData.summary}
    - Laps: ${lapsString}
    
    Review this run. Be punchy and specific. 
    IMPORTANT: Always explicitly reference the run being reviewed (e.g., "In today's ${runData.runType} run...", "Your ${runData.distance}km session on ${runData.date}...") so the athlete knows exactly which activity you are discussing.
    Take upcoming runs AND custom life events into account (e.g. if a hard run is next or they have social drinks or a concert tonight/tomorrow, suggest extra recovery, proper rest, or timing adjustments).
    Use the PHYSIOLOGICAL CONTEXT to explain performance variations (e.g., if HRV is unbalanced or sleep is low, acknowledge that the athlete might have felt flatter).
 
    DATA INTERPRETATION RULES:
    1. LAST LAP SENSITIVITY: If the final lap is very short (e.g., < 100m) and slow, assume the athlete forgot to stop their watch immediately. Mention the main run stats but ignore the "tail" in your performance analysis.
    2. CADENCE ANALYSIS: If a training session includes walking segments (detected by very low pace or laps with cadence < 120), you MUST IGNORE the "Average Cadence" metric for the entire session and the cadence of those walking segments. Only look at the cadence of the actual running laps to determine form. If you cannot isolate the running cadence, do not mention cadence at all.
    3. POWER & BIOMECHANICS: If power, ground contact time (GCT), vertical oscillation, or stride length data is present, evaluate the athlete's running form and efficiency trends. Higher GCT or excessive vertical oscillation indicates a loss of running economy, while a strong average power vs. pace shows great output. If temperature is high (e.g., > 25°C), note that cardiac drift (heart rate rising for the same power/pace) is expected and normal.
    
    TASK:
    1. Analyze the "Laps" to identify the structure (e.g., which laps were warm-up/cool-down vs. the main effort).
    2. Compare the actual performance against any matching "UPCOMING PLANNED RUNS" for today's date.
    
    RETURN ONLY JSON:
    { 
      "short": "max 12 words", 
      "long": "3-4 sentences",
      "structure": "A detailed factual breakdown of what the run actually entailed based on laps, explicitly including the pace and average heart rate (if HR data is present) for each distinct segment (e.g., '2K warmup at 5:40/km (avg HR: 130 bpm), 5K main effort at 4:35/km (avg HR: 168 bpm), 1K cooldown at 6:00/km (avg HR: 135 bpm)'). Mention if it matched the plan."
    }
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
export async function updateTrainingReport(currentReport: string, runData: Run, userStats: any = {}) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) return { report: currentReport, status: userStats.status };
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const healthPerformanceContext = `
    - VO2 Max: ${userStats.performance?.vo2max || 'N/A'}
    - Lactate Threshold: ${userStats.performance?.thresholdPace || 'N/A'} @ ${userStats.performance?.thresholdHR || 'N/A'} bpm
    - HRV (7d Avg): ${userStats.health?.hrv7d || 'N/A'} ms
    - HRV Status: ${userStats.health?.hrvStatus || 'N/A'}
    - RHR: ${userStats.health?.rhr || 'N/A'} bpm
    - Sleep (7d Avg Score): ${userStats.health?.sleep || 'N/A'}
  `;

  const prompt = `
    You are an expert running coach updating an athlete's "Training Status & Strategy" report and overall Training Focus.
    Today's Date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

    The report MUST always follow this exact 4-header structure:
    1. Current Training Phase & Objectives
    2. Physiological Status & Fitness
    3. Biomechanics & Form Trends
    4. Short-Term Strategy (Next 2-3 Weeks)

    NEW DATA TO INTEGRATE:
    Run on ${runData.date}: ${runData.distance}km, ${runData.averagePace}/km, ${runData.averageHeartRate || 'N/A'}bpm, ${runData.averageCadence || 'N/A'}spm.
    Athlete Notes: ${runData.summary || "None"}
    Current Physiological Metrics: ${healthPerformanceContext}
    Current Training Focus Status: ${userStats.status || "N/A"}

    DATA INTERPRETATION RULES:
    1. CADENCE ANALYSIS: If this run included walking segments or if the average cadence is misleadingly low due to breaks, you MUST IGNORE the cadence for this session when updating "Biomechanics & Form Trends". Only use cadence data that you are certain represents active running.

    TASK:
    1. Update the existing report content based on this new run AND the current physiological metrics.
    2. Review and update the "Training Status" (focus). Valid values: "Productive", "Peaking", "Maintenance", "Recovery", "Overreaching", "Detraining". 
       - If metrics like HRV or Sleep are trending poorly, or if the run performance contradicts the current VO2 Max/Threshold data, adjust the status and the sections 2 and 4 accordingly.
    3. Maintain all long-term context that is still relevant.
    4. If no significant update is needed for a specific section, keep it as is.

    RETURN ONLY JSON:
    {
      "report": "the full updated report text",
      "status": "the updated training focus status"
    }

    CURRENT REPORT:
    ${currentReport}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      report: parsed.report || currentReport,
      status: parsed.status || userStats.status
    };
  } catch (error) {
    console.error("Update Report Error:", error);
    return { report: currentReport, status: userStats.status };
  }
}

export interface RaceData {
  name?: string;
  targetDistance?: number | string;
  date?: string;
  targetTime?: string;
}

export async function generatePrediction(
  recentRuns: Run[],
  userStats: any,
  strategyReport: string,
  previousPrediction?: any,
  upcomingRaces?: RaceData[],
  trainingMode?: 'race' | 'building',
  efDetails?: {
    currentEF: number | null;
    efTrendPercent: number;
    runsAnalyzedCount: number;
    runs: { date: string; distance: number; runType: string; ef: number }[];
  }
) {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const runsContext = recentRuns.length > 0
    ? recentRuns.map(r => {
        let details = `- ${r.date}: ${r.runType}, ${r.distance}km, Avg Pace: ${r.averagePace}, Avg HR: ${r.averageHeartRate || 'N/A'}, Avg Cadence: ${r.averageCadence || 'N/A'}`;
        if (r.aiDescription) {
          details += `\n  Structure: ${r.aiDescription}`;
        }
        if (r.laps && r.laps.length > 0) {
          const lapsStr = r.laps.map(l => `    * Lap ${l.lapNumber}: ${l.distance}km, Pace: ${l.avgPace}, HR: ${l.avgHR || 'N/A'}${l.avgPower !== undefined ? `, Power: ${l.avgPower}W` : ''}`).join('\n');
          details += `\n  Laps:\n${lapsStr}`;
        }
        return details;
      }).join('\n')
    : "No recent runs available.";

  const isBuildingMode = trainingMode === 'building';
  
  // Calculate upcoming races string
  const upcomingRacesContext = upcomingRaces && upcomingRaces.length > 0
    ? upcomingRaces.map(r => `- ${r.name}: ${r.targetDistance} km on ${r.date} (Target: ${r.targetTime})`).join('\n')
    : "No upcoming races registered.";

  // Calculate previous prediction string
  let previousPredictionContext = "No previous prediction available.";
  if (previousPrediction) {
    if (previousPrediction.targetDistance === 'Aerobic Efficiency (EF)' || previousPrediction.targetTime === 'Base Building') {
      previousPredictionContext = `
      - Last Calculated EF: ${previousPrediction.currentEstimate || 'Unknown'}
      - Autonomic Readiness Score: ${previousPrediction.probability !== undefined ? previousPrediction.probability + '%' : 'Unknown'}
      - Previous Insight: "${previousPrediction.coachComment || ''}"
      - Last Updated: ${previousPrediction.lastUpdated || 'Unknown'}
      `;
    } else {
      previousPredictionContext = `
      - Estimated Race Time: ${previousPrediction.currentEstimate || 'Unknown'} (Distance: ${previousPrediction.targetDistance || '10K'})
      - Target Success Probability: ${previousPrediction.probability !== undefined ? previousPrediction.probability + '%' : 'Unknown'}
      - Previous Insight: "${previousPrediction.coachComment || ''}"
      - Last Updated: ${previousPrediction.lastUpdated || 'Unknown'}
      `;
    }
  }

  console.log(`Gemini: Generating prediction in ${trainingMode || 'race'} mode. Runs context length: ${runsContext.length} chars.`);

  let prompt = '';

  if (isBuildingMode && efDetails) {
    const runsEFContext = efDetails.runs.map(r => 
      `- ${r.date}: ${r.runType}, ${r.distance}km, EF: ${r.ef}`
    ).join('\n');

    prompt = `
      You are an expert running coach. Analyze this athlete's Aerobic Efficiency (Pace-to-HR ratio / Efficiency Factor) and their recovery status to provide actionable feedback for their base building phase.
      Today's Date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      
      TRAINING FOCUS: Base Building (Aerobic Capacity & Joint Resilience)
      HRV & HEALTH METRICS:
      - HRV (7d Avg): ${userStats.health?.hrv7d || 'N/A'} ms (Status: ${userStats.health?.hrvStatus || 'N/A'}, Updated: ${userStats.health?.lastUpdated || 'Unknown'})
      - Resting HR: ${userStats.health?.rhr || 'N/A'} bpm
      - Sleep (7d Avg): ${userStats.health?.sleep || 'N/A'}
      
      AEROBIC EFFICIENCY DATA (Calculated deterministically from easy/long runs, with watch-stop tails filtered out):
      - Current Rolling 7-day EF: ${efDetails.currentEF || 'N/A'} (Speed in meters/minute divided by average HR. Higher is better/more efficient)
      - Week-over-Week EF Trend: ${efDetails.efTrendPercent > 0 ? '+' : ''}${efDetails.efTrendPercent}% (Compared to previous 7 days)
      - Runs analyzed: ${efDetails.runsAnalyzedCount} runs
      - Run EFs:
      ${runsEFContext}
      
      PREVIOUS PREDICTION/MONITOR STATE:
      ${previousPredictionContext}

      RECENT RUN DETAILS:
      ${runsContext}

      IMPORTANT: Do NOT perform any math or try to compute the EF yourself. Use the exact values provided. Your job is to *interpret* these numbers as an expert coach.

      TONE AND LANGUAGE STYLE:
      - Write in plain, simple, friendly, and practical coaching language.
      - Avoid overly academic, clinical, or heavy sports science terminology.
      - Do NOT use terms like "cardiovascular drift", "cardiac decoupling", "aerobic economy", "autonomic metrics", "autonomic state", "autonomic nervous system", or "systemic stress".
      - Instead, explain these concepts in simple, practical terms. E.g.:
        - Instead of "cardiovascular drift" or "decoupling", say "your heart rate climbing higher even though you slowed down".
        - Instead of "aerobic economy/efficiency factor", talk about "how hard your heart has to work to run at a certain speed".
        - Instead of "autonomic health metrics/nervous system", talk about "your body's battery", "fatigue levels", or "recovery indicators".
      - Keep sentences clear, direct, and encouraging. Explain all numbers and advice so they are easy for a recreational runner to follow and put into practice.
      
      TASK:
      1. Interpret the current rolling EF (${efDetails.currentEF}) and the trend (${efDetails.efTrendPercent}%). Connect it to their recovery from the recent layoff, their unbalanced HRV (${userStats.health?.hrv7d || 'N/A'} ms), cardiovascular drift observed in their runs (like the August 2nd return jog), or biomechanics.
      2. Evaluate their autonomic nervous system (HRV & Sleep) and estimate their overall "Autonomic Readiness / Base Building Load Capacity" on a scale from 0 to 100%. (This maps to the "probability" field in the JSON).
      3. Write a brief, punchy coach comment (max 25 words) summing up their current aerobic base state.
      4. Write a detailed reasoning (2-3 paragraphs) detailing your analysis of their efficiency trends, heart rate decoupling, and how to structure their Zone 2/strength sessions over the next 2 weeks. Be specific about recent dates.
      5. COMPARISON & EXPLANATION OF CHANGES: Explain what changed or remained stable in the "whatHasChanged" field, comparing the new EF and readiness score to the previous monitor state.
      
      RETURN ONLY JSON:
      {
        "targetDistance": "Aerobic Efficiency (EF)",
        "targetTime": "Base Building",
        "currentEstimate": "${efDetails.currentEF || '--'}",
        "probability": number, // Your evaluated Autonomic Readiness / Base Load Capacity (0-100)
        "coachComment": "string",
        "detailedReasoning": "string",
        "whatHasChanged": "string"
      }
    `;
  } else {
    // Race Mode (Default)
    prompt = `
      You are an expert running coach. Analyze this athlete's recent training to predict their current race fitness for their primary goal and the probability of hitting their target.
      Today's Date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      
      PRIMARY GOALS: ${userStats.goals?.join(', ') || "None"}
      UPCOMING RACES:
      ${upcomingRacesContext}
      
      STRATEGY REPORT: ${strategyReport}

      HEALTH & PERFORMANCE METRICS:
      - VO2 Max: ${userStats.performance?.vo2max || 'N/A'} (Updated: ${userStats.performance?.lastUpdated || 'Unknown'})
      - Lactate Threshold: ${userStats.performance?.thresholdPace || 'N/A'} @ ${userStats.performance?.thresholdHR || 'N/A'} bpm
      - HRV (7d Avg): ${userStats.health?.hrv7d || 'N/A'} ms (Updated: ${userStats.health?.lastUpdated || 'Unknown'})
      - HRV Status: ${userStats.health?.hrvStatus || 'N/A'}
      - Resting HR: ${userStats.health?.rhr || 'N/A'} bpm
      - Sleep (7d Avg): ${userStats.health?.sleep || 'N/A'}
      
      PREVIOUS PREDICTION:
      ${previousPredictionContext}

      RECENT RUNS (Latest 20):
      ${runsContext}
      
      IMPORTANT: Pay close attention to the "Structure" (aiDescription) and the individual "Laps" listed for each run. This describes the actual breakdown (e.g., distinguishing warmup from main effort). You must evaluate the pace, intensity, and average heart rate of the *main effort* described in the structure and laps to anchor your fitness estimate.

      DATA INTERPRETATION RULES:
      1. CADENCE ANALYSIS: If a run structure indicates walking or if the average cadence is significantly lower than typical running cadence, you MUST IGNORE the "Cadence" metric for that run.
      
      TONE AND LANGUAGE STYLE:
      - Write in plain, simple, friendly, and practical coaching language.
      - Avoid overly academic, clinical, or heavy sports science terminology.
      - Do NOT use terms like "cardiovascular drift", "cardiac decoupling", "aerobic economy", "autonomic metrics", "autonomic state", "autonomic nervous system", or "systemic stress".
      - Instead, explain these concepts in simple, practical terms. E.g.:
        - Instead of "cardiovascular drift" or "decoupling", say "your heart rate climbing higher even though you slowed down".
        - Instead of "aerobic economy/efficiency factor", talk about "how hard your heart has to work to run at a certain speed".
        - Instead of "autonomic health metrics/nervous system", talk about "your body's battery", "fatigue levels", or "recovery indicators".
      - Keep sentences clear, direct, and encouraging. Explain all numbers and advice so they are easy for a recreational runner to follow and put into practice.

      TASK:
      1. IDENTIFY TARGET DISTANCE & TIME: Determine the athlete's primary active target running goal. Prioritize any upcoming registered races. If there are no upcoming races, fall back to the first goal listed under PRIMARY GOALS (e.g. "Shatter Half Marathon PB (Sub-1:40:00)"). Identify the distance (e.g. "5K", "10K", "Half Marathon", "Marathon") and the target time (e.g. "Sub-1:40:00", "Sub-47:30").
      2. ESTIMATE CURRENT TIME: Estimate their current race finish time for THAT target distance based on all available training data. Format it as H:MM:SS for Half/Full Marathon, or MM:SS for 5K/10K.
      3. Calculate probability (0-100) of hitting the target time.
      4. Provide a brief, punchy coach insight (max 25 words).
      5. Provide a detailed reasoning (2-3 paragraphs) explaining the data points, trends, and specific runs that led to this prediction. Be specific about dates.
      6. COMPARISON & EXPLANATION OF CHANGES: Compare your new estimate and probability against the previous values. Explain what changed in the "whatHasChanged" field.
      
      RETURN ONLY JSON:
      {
        "targetDistance": "string (e.g., 'Half Marathon', '10K', '5K', 'Marathon')",
        "targetTime": "string (e.g., 'Sub-1:40:00', 'Sub-47:30')",
        "currentEstimate": "string (H:MM:SS or MM:SS)",
        "probability": number,
        "coachComment": "string",
        "detailedReasoning": "string",
        "whatHasChanged": "string"
      }
    `;
  }

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
      targetDistance: isBuildingMode ? "Aerobic Efficiency (EF)" : "10K",
      targetTime: isBuildingMode ? "Base Building" : "Sub-47:30",
      currentEstimate: isBuildingMode ? "--" : "--:--",
      probability: 50,
      coachComment: "I'm having trouble analyzing your data right now. Check back in a moment.",
      detailedReasoning: "The AI analysis encountered an error. This usually happens when the model is overloaded or the data structure is unexpected.",
      whatHasChanged: "Could not retrieve change history due to an analysis error."
    };
  }
}


// --- NEW COACH CHAT CAPABILITIES ---

export const COACH_SYSTEM_INSTRUCTION = `
You are "The Coach", a world-class running and strength coach for a tall athlete (194cm).
You are direct, motivating, and data-driven.
You have access to the athlete's full history, including runs, gym workouts, and long-term strategy.
Your goal is to help the athlete reach their goals (currently Sub-47:30 10K by August 1st).

ATHLETE PREFERENCES & SCHEDULE:
- WEEKLY RHYTHM: 4 runs per week, always in the morning.
- START TIMES: Weekdays at 07:15, Weekends at 09:00.
- RUN DAYS: Tuesday, Thursday, Friday, and Sunday (Long Run).
- STRENGTH DAYS: Wednesday (at the Office) and Friday.
- OFFICE DAYS: Monday and Wednesday (prefers no running these days).
- RECOVERY DAYS: Monday and Saturday (no scheduled sessions).
- PERIODIZATION PRINCIPLES:
    1. DELOAD WEEKS: Aim for a deload week (reduced volume/intensity) approximately every 4 weeks. However, be flexible—take the athlete's schedule, holidays, and high-fatigue signals (HRV/Sleep) into account. Always propose a deload week first and explain why it's timed that way.
    2. RACE TAPERING: Implement a taper leading up to "Race" or "Time Trial" events. Scale the taper duration and intensity based on the race distance (e.g., 1 week for a 5K/10K, 2-3 weeks for a Half or Full Marathon). Ensure the taper maintains movement quality while shedding accumulated fatigue.
- CONSTRAINT: Always keep the plan realistic based on this 194cm athlete's status.

CONTEXTUAL AWARENESS:
- You MUST ALWAYS check the current date before giving advice. Today's Date is provided in the athlete data.
- Review past runs (history) to see if the athlete is under or over-training. Be specific: mention the date and type of run when referencing specific activities (e.g., "Your workout last Tuesday...").
- PHYSIOLOGICAL CONTEXT: You have access to 7-day averages for HRV, RHR, and Sleep. Use these trends to judge "Readiness". 
    - HRV Status (Balanced/Unbalanced/Low): This is your primary indicator for training load adjustments.
    - Sleep (7d Avg Score): Use this to explain fatigue levels.
    - Performance Metrics (VO2 Max, Lactate Threshold): Use these to anchor your pace and fitness expectations.
- IMPORTANT: For recent runs, pay close attention to the "aiDescription" field. This contains the AI's structural breakdown of the run (e.g., distinguishing warmup from main effort). Use this to understand the actual quality of the session rather than just the average metrics.
- Review upcoming runs (planned schedule) to help the athlete prepare for what's next. Use this context to identify if the current pace/intensity is sustainable or if the upcoming plan needs adjustment based on recent performance.
- **CUSTOM LIFE EVENTS:** You have access to the athlete's custom scheduled life events (e.g., social drinks, concerts, work meetings, travel). Check these events to see if they conflict with training days or might impact recovery and fatigue (e.g., suggest rest or lighter runs if the athlete has drinks scheduled the night before a run).
- **PLAN VISIBILITY:** By default, you only see the next 10 upcoming runs. If you need to see the entire long-term training plan (e.g., to review a 2-month block or check a race date far in the future), explicitly use the \`get_athlete_data\` tool with \`includeFullPlan: true\`.
- IMPORTANT: You can now generate or **revise** a training plan using the "generate_training_plan" tool. If you notice the athlete is consistently over-performing, struggling with fatigue, or if their physiological metrics (HRV/Sleep) are poor, proactively suggest specific improvements to the upcoming plan and call the tool to update it after confirmation.

DATA INTERPRETATION RULES:
1. LAST LAP SENSITIVITY: If a run's final lap is very short (e.g., < 100m) and slow, assume the athlete stopped their watch late. Ignore this "tail" in your analysis.
2. CADENCE ANALYSIS: If a training session includes walking segments (detected by very low pace or laps with cadence < 120), you MUST IGNORE the "Average Cadence" metric for the entire session and the cadence of those walking segments. Only consider the cadence of the active running segments/laps for form analysis. If walking was a significant part of the training, avoid commenting on cadence unless you can isolate the running-only data.

TRAINING STATUS & STRATEGY:
- There is a high-level "Training Status" badge on the dashboard. Valid values are: "Productive", "Peaking", "Maintenance", "Recovery", "Overreaching", "Detraining".
- There is also a detailed "Athlete Training Status & Strategy" report with 4 headers:
  1. Current Training Phase & Objectives
  2. Physiological Status & Fitness
  3. Biomechanics & Form Trends
  4. Short-Term Strategy (Next 2-3 Weeks)

UPDATES:
- If the athlete's data or current state changes (e.g., injury, high fatigue, or peak fitness):
  1. Propose an update to the "Training Status" (the badge) AND/OR the detailed strategy report.
  2. Ask for explicit confirmation.
  3. ONLY call the "update_status" or "update_strategy_report" tools AFTER confirmation.
- To update the report, you MUST first use "get_athlete_data" to get the current content, then provide the full, revised text using the exact 4-header structure to "update_strategy_report".
- RACES & REVIEWS: If the user asks you to modify, rewrite, or adjust their planned race strategy or their post-race review, you MUST rewrite/update the strategy or review. Explain what you are changing, ask for confirmation, and then call the \`update_race_strategy\` or \`update_race_review\` tools respectively to save the updated Markdown copy.

If the athlete wants to change their primary goals, use "update_goals".

Be concise but thorough. Use emojis sparingly but effectively 🏃‍♂️🏋️‍♂️.
`;

export const coachTools: any[] = [
  {
    functionDeclarations: [
      {
        name: "get_athlete_data",
        description: "Get the athlete's current goals, PBs, strategy report, custom scheduled life events, and recent activities. Use includeFullPlan: true to see the entire future schedule.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            includeFullPlan: { 
              type: SchemaType.BOOLEAN, 
              description: "Whether to fetch the entire future training plan instead of just the next 10 runs." 
            }
          }
        }
      },
      {
        name: "update_status",
        description: "Update the high-level Training Status badge (e.g., Productive, Recovery).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            status: { 
              type: SchemaType.STRING, 
              enum: ["Productive", "Peaking", "Maintenance", "Recovery", "Overreaching", "Detraining"],
              description: "The new training status." 
            }
          },
          required: ["status"]
        }
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
      },
      {
        name: "generate_training_plan",
        description: "Generates a structured training plan for the next 2 months. Use this when the athlete asks for a new plan.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            plan: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  date: { type: SchemaType.STRING, description: "Date of the workout (YYYY-MM-DD)" },
                  startTime: { type: SchemaType.STRING, description: "Start time of the workout (HH:MM)" },
                  runType: { type: SchemaType.STRING, description: "Type of run (e.g. Easy, Interval, Tempo, Long Run)" },
                  distance: { type: SchemaType.STRING, description: "Distance (e.g. 5km, 10km, 1:20h)" },
                  description: { type: SchemaType.STRING, description: "Detailed instructions for the workout." }
                },
                required: ["date", "startTime", "runType", "distance", "description"]
              }
            }
          },
          required: ["plan"]
        }
      },
      {
        name: "update_race_strategy",
        description: "Updates or rewrites the pre-race pacing and strategy guide for the active race.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            content: { type: SchemaType.STRING, description: "The full updated Markdown strategy text. Include pacing splits table." }
          },
          required: ["content"]
        }
      },
      {
        name: "update_race_review",
        description: "Updates or rewrites the post-race review analysis for the active race.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            content: { type: SchemaType.STRING, description: "The full updated Markdown post-race analysis text." }
          },
          required: ["content"]
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
