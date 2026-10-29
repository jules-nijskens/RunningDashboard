import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { garminJson, GARMIN_PATHS } from '@/lib/garmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    const list = await garminJson<any[]>(`${GARMIN_PATHS.activityList}?start=0&limit=15`);
    const activities = (Array.isArray(list) ? list : [])
      .filter((a) => {
        const key = a?.activityType?.typeKey || '';
        return key.includes('running');
      })
      .slice(0, 3)
      .map((a) => ({
        id: String(a.activityId),
        name: a.activityName || 'Run',
        startTime: a.startTimeLocal || a.startTimeGMT,
        distanceKm: parseFloat(((a.distance || 0) / 1000).toFixed(2)),
        durationSec: Math.round(a.duration || 0),
      }));

    return NextResponse.json({ activities });
  } catch (error: any) {
    console.error('Garmin activity list failed:', error);
    const status = /Unauthorized/.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: error.message || 'Garmin request failed.' }, { status });
  }
}
