import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { garminJson, downloadFit, GARMIN_PATHS } from '@/lib/garmin';
import FitParser from 'fit-file-parser';

export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().split('T')[0];
const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined);

function mapHrvStatus(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).toUpperCase();
  if (s === 'BALANCED') return 'Balanced';
  if (s === 'UNBALANCED') return 'Unbalanced';
  if (s === 'LOW' || s === 'POOR') return 'Low';
  return undefined;
}

/**
 * Pulls the last 7 days of HRV, resting HR, and sleep scores using the official
 * Garmin Connect Personal API OpenAPI endpoints, plus VO2 max, Threshold Pace,
 * and Threshold HR from heart-rate zones and the latest running activity FIT file.
 */
export async function POST(request: Request) {
  try {
    await verifyAuth(request);

    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const from = iso(weekAgo);
    const to = iso(today);
    const yest = iso(yesterday);

    const health: Record<string, string> = {};
    const performance: Record<string, string> = {};
    const errors: string[] = [];

    await Promise.all([
      // 1. HRV (7d avg + status): try range first, fall back to single-day endpoints
      (async () => {
        try {
          let summaries: any[] = [];
          try {
            const data = await garminJson(GARMIN_PATHS.hrvRange(from, to));
            summaries = data?.hrvSummaries || [];
          } catch {
            // Fall back to single-day HRV endpoint for today / yesterday
            const dayData = (await garminJson(GARMIN_PATHS.hrvDay(to)).catch(() => null))
              || (await garminJson(GARMIN_PATHS.hrvDay(yest)).catch(() => null));
            if (dayData?.hrvSummary) summaries = [dayData.hrvSummary];
          }
          const weekly = summaries.map((s) => s?.weeklyAvg).filter((n) => typeof n === 'number');
          const nightly = summaries.map((s) => s?.lastNightAvg).filter((n) => typeof n === 'number');
          const value = weekly.length ? weekly[weekly.length - 1] : avg(nightly);
          if (value !== undefined) health.hrv7d = String(Math.round(value));
          // Use the most recent day that actually has a usable status
          const mappedStatus = [...summaries]
            .reverse()
            .map((s) => mapHrvStatus(s?.status))
            .find(Boolean);
          if (mappedStatus) health.hrvStatus = mappedStatus;
        } catch (e: any) {
          errors.push(`HRV: ${e.message}`);
        }
      })(),

      // 2. Resting HR (7d avg) via /usersummary-service/v2/dailysummaries
      (async () => {
        try {
          const data = await garminJson(GARMIN_PATHS.dailySummariesV2(from, to));
          const rows: any[] = data?.data || (Array.isArray(data) ? data : []);
          const nums = rows
            .map((r) => r?.heartRate?.restingValue ?? r?.restingHeartRate)
            .filter((n) => typeof n === 'number' && n > 0);
          const a = avg(nums);
          if (a !== undefined) {
            health.rhr7d = String(Math.round(a));
          } else {
            const daily = (await garminJson(GARMIN_PATHS.userSummaryDay(to)).catch(() => null))
              || (await garminJson(GARMIN_PATHS.userSummaryDay(yest)).catch(() => null));
            const rhr = daily?.lastSevenDaysAvgRestingHeartRate ?? daily?.restingHeartRate;
            if (typeof rhr === 'number' && rhr > 0) health.rhr7d = String(Math.round(rhr));
          }
        } catch (e: any) {
          errors.push(`Resting HR: ${e.message}`);
        }
      })(),

      // 3. Sleep (7d avg score) via /sleep-service/sleep/dailySleepSummariesByDate
      (async () => {
        try {
          const data = await garminJson<any[]>(GARMIN_PATHS.sleepRange(from, to));
          const rows: any[] = Array.isArray(data) ? data : data ? [data] : [];
          const scores = rows
            .map((s) => s?.sleepScores?.overall?.value ?? s?.sleepScores?.totalDuration?.value)
            .filter((n) => typeof n === 'number' && n > 0);
          const a = avg(scores);
          if (a !== undefined) health.sleep = String(Math.round(a));
        } catch (e: any) {
          errors.push(`Sleep: ${e.message}`);
        }
      })(),

      // 4. Performance (VO2 Max, Threshold Pace, Threshold HR) from HR zones + latest running FIT file
      (async () => {
        try {
          const [zones, acts] = await Promise.all([
            garminJson<any[]>(GARMIN_PATHS.heartRateZones).catch(() => null),
            garminJson<any[]>(`${GARMIN_PATHS.activityList}?start=0&limit=10`),
          ]);

          if (Array.isArray(zones)) {
            const runZone = zones.find((z) => z?.sport === 'RUNNING') || zones.find((z) => z?.sport === 'DEFAULT') || zones[0];
            const lthr = runZone?.lactateThresholdHeartRateUsed;
            if (typeof lthr === 'number' && lthr > 0) {
              performance.thresholdHR = String(Math.round(lthr));
            }
          }

          const list = (Array.isArray(acts) ? acts : []).filter((a) =>
            String(a?.activityType?.typeKey || '').includes('running')
          );

          const latestRun = list[0];
          if (latestRun?.activityId) {
            const fitBuffer = await downloadFit(String(latestRun.activityId));
            const fitParser = new FitParser({ force: true, mode: 'list' });
            const parsed = await new Promise<any>((resolve, reject) => {
              fitParser.parse(fitBuffer, (err, data) => (err ? reject(new Error(err)) : resolve(data)));
            });

            const userMetrics = parsed?.user_metrics?.[0];
            const actMetrics = parsed?.activity_metrics?.[0];
            const zonesTarget = parsed?.zones_target;

            const vo2 = userMetrics?.vo2_max ?? actMetrics?.vo2_max ?? latestRun?.vO2MaxValue;
            if (typeof vo2 === 'number' && vo2 > 0) {
              performance.vo2max = String(Math.round(vo2));
            }

            // Garmin stores user_metrics.ltspeed in 0.1 km/h (scale 36 for m/s),
            // while fit-file-parser divides the raw uint16 by 1000.
            // So pace in seconds/km = 1000 / ((ltspeed * 1000) / 36) = 36 / ltspeed.
            const ltSpeed = userMetrics?.ltspeed;
            if (typeof ltSpeed === 'number' && ltSpeed > 0) {
              const paceSec = Math.round(36 / ltSpeed);
              const mins = Math.floor(paceSec / 60);
              const secs = String(paceSec % 60).padStart(2, '0');
              performance.thresholdPace = `${mins}:${secs}`;
            }

            if (!performance.thresholdHR) {
              const fallbackHr = zonesTarget?.threshold_heart_rate ?? userMetrics?.lthr;
              if (typeof fallbackHr === 'number' && fallbackHr > 0) {
                performance.thresholdHR = String(Math.round(fallbackHr));
              }
            }
          }
        } catch (e: any) {
          errors.push(`Performance: ${e.message}`);
        }
      })(),
    ]);

    return NextResponse.json({ health, performance, errors });
  } catch (error: any) {
    console.error('Garmin health sync failed:', error);
    const status = /Unauthorized/.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: error.message || 'Garmin request failed.' }, { status });
  }
}
