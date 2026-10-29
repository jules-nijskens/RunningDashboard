import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { garminJson, GARMIN_PATHS } from '@/lib/garmin';

export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().split('T')[0];
const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined);

/**
 * Pulls the last 7 days of HRV / resting HR / sleep plus VO2 max.
 * Each metric is fetched independently, so one failing endpoint
 * doesn't block the others. Only successfully fetched fields are returned.
 */
export async function POST(request: Request) {
  try {
    await verifyAuth(request);

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const from = iso(weekAgo);
    const to = iso(today);

    const health: Record<string, string> = {};
    const performance: Record<string, string> = {};
    const errors: string[] = [];

    await Promise.all([
      (async () => {
        try {
          const data = await garminJson(GARMIN_PATHS.hrv(from, to));
          const summaries: any[] = data?.hrvSummaries || [];
          const weekly = summaries.map((s) => s.weeklyAvg).filter((n) => typeof n === 'number');
          const nightly = summaries.map((s) => s.lastNightAvg).filter((n) => typeof n === 'number');
          const value = weekly.length ? weekly[weekly.length - 1] : avg(nightly);
          if (value !== undefined) health.hrv7d = String(Math.round(value));
          const status = summaries[summaries.length - 1]?.status;
          if (status) {
            const s = String(status).toUpperCase();
            health.hrvStatus = s === 'BALANCED' ? 'Balanced' : s === 'UNBALANCED' ? 'Unbalanced' : s === 'LOW' ? 'Low' : 'Balanced';
          }
        } catch (e: any) { errors.push(`HRV: ${e.message}`); }
      })(),
      (async () => {
        try {
          const data = await garminJson(GARMIN_PATHS.restingHr(from, to));
          const values: any[] = data?.values || (Array.isArray(data) ? data : []);
          const nums = values
            .map((v) => v?.values?.restingHR ?? v?.restingHR ?? v?.restingHeartRate)
            .filter((n) => typeof n === 'number');
          const a = avg(nums);
          if (a !== undefined) health.rhr7d = String(Math.round(a));
        } catch (e: any) { errors.push(`Resting HR: ${e.message}`); }
      })(),
      (async () => {
        try {
          const data = await garminJson(GARMIN_PATHS.sleep(from, to));
          const values: any[] = data?.individualStats || data?.values || (Array.isArray(data) ? data : []);
          const nums = values
            .map((v) => v?.values?.sleepScore ?? v?.sleepScore ?? v?.values?.overallSleepScore)
            .filter((n) => typeof n === 'number');
          const a = avg(nums);
          if (a !== undefined) health.sleep = String(Math.round(a));
        } catch (e: any) { errors.push(`Sleep: ${e.message}`); }
      })(),
      (async () => {
        try {
          const data = await garminJson(GARMIN_PATHS.vo2max(to));
          const v = data?.generic?.vo2MaxPreciseValue ?? data?.generic?.vo2MaxValue ?? data?.vo2MaxPreciseValue;
          if (typeof v === 'number') performance.vo2max = v.toFixed(1);
        } catch (e: any) { errors.push(`VO2 max: ${e.message}`); }
      })(),
    ]);

    return NextResponse.json({ health, performance, errors });
  } catch (error: any) {
    console.error('Garmin health sync failed:', error);
    const status = /Unauthorized/.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: error.message || 'Garmin request failed.' }, { status });
  }
}
