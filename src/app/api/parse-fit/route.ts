import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import FitParser from 'fit-file-parser';
import { Run, Lap } from '@/types/run';

function formatPace(speedMps: number | undefined): string {
  if (!speedMps || speedMps <= 0) return '0:00';
  const paceSec = 1000 / speedMps;
  const minutes = Math.floor(paceSec / 60);
  const seconds = Math.floor(paceSec % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number | undefined): string {
  if (!totalSeconds || totalSeconds <= 0) return '00:00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function parseSemicircles(val: number | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  // If the absolute value is > 180, it's in semicircles, otherwise it's already in degrees
  if (Math.abs(val) > 180) {
    return val * (180 / Math.pow(2, 31));
  }
  return val;
}

export async function POST(request: Request) {
  try {
    // 1. Verify Auth
    await verifyAuth(request);

    // 2. Extract FIT File
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Parse FIT File
    const fitParser = new FitParser({
      force: true,
      mode: 'list',
    });

    const parsedData = await new Promise<any>((resolve, reject) => {
      fitParser.parse(buffer, (error, data) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      });
    });

    // 4. Extract Sessions, Laps, Records
    const sessions = parsedData.sessions || [];
    const rawLaps = parsedData.laps || [];
    const rawRecords = parsedData.records || [];

    if (sessions.length === 0) {
      return NextResponse.json({ error: 'No session data found in FIT file.' }, { status: 400 });
    }

    const session = sessions[0];

    // Extract route coordinates from records
    const routeCoordinates: { lat: number; lon: number }[] = [];
    rawRecords.forEach((record: any) => {
      const lat = parseSemicircles(record.position_lat || record.position_lat_in_semicircles);
      const lon = parseSemicircles(record.position_long || record.position_long_in_semicircles);
      if (lat !== undefined && lon !== undefined) {
        routeCoordinates.push({ lat, lon });
      }
    });

    // Downsample coordinates: Keep 1 point every 10 records
    const downsampledCoords: { lat: number; lon: number }[] = [];
    for (let i = 0; i < routeCoordinates.length; i++) {
      if (i % 10 === 0 || i === routeCoordinates.length - 1) {
        downsampledCoords.push(routeCoordinates[i]);
      }
    }

    // Map Laps
    const laps: Lap[] = rawLaps.map((lap: any, index: number) => {
      const distanceM = lap.total_distance || 0;
      const durationS = lap.total_timer_time || lap.total_elapsed_time || 0;
      const speedMps = lap.enhanced_avg_speed || lap.avg_speed || (durationS > 0 ? distanceM / durationS : 0);

      // Cadence is single-leg, double it for steps per minute (spm)
      const avgCadence = lap.avg_running_cadence !== undefined 
        ? lap.avg_running_cadence * 2 
        : (lap.avg_cadence !== undefined ? lap.avg_cadence * 2 : 0);

      return {
        lapNumber: index + 1,
        time: formatDuration(durationS),
        distance: parseFloat((distanceM / 1000).toFixed(2)),
        avgPace: formatPace(speedMps),
        avgHR: Math.round(lap.avg_heart_rate || 0),
        maxHR: Math.round(lap.max_heart_rate || 0),
        avgCadence: Math.round(avgCadence),
        avgPower: lap.avg_power !== undefined ? Math.round(lap.avg_power) : undefined,
        avgStanceTime: lap.avg_stance_time !== undefined ? parseFloat(lap.avg_stance_time.toFixed(1)) : undefined,
        avgVerticalOscillation: lap.avg_vertical_oscillation !== undefined ? parseFloat(lap.avg_vertical_oscillation.toFixed(1)) : undefined,
        avgStepLength: lap.avg_step_length !== undefined ? parseFloat(lap.avg_step_length.toFixed(1)) : undefined,
        avgTemperature: lap.avg_temperature !== undefined ? Math.round(lap.avg_temperature) : undefined,
      };
    });

    // Format Overall Metrics
    const distanceKm = parseFloat(((session.total_distance || 0) / 1000).toFixed(2));
    const activeTimeS = session.total_timer_time || session.total_elapsed_time || 0;
    const avgSpeedMps = session.enhanced_avg_speed || session.avg_speed || (activeTimeS > 0 ? (session.total_distance || 0) / activeTimeS : 0);

    const overallCadence = session.avg_running_cadence !== undefined 
      ? session.avg_running_cadence * 2 
      : (session.avg_cadence !== undefined ? session.avg_cadence * 2 : 0);

    // Format ISO Date for date input
    const startTimeDate = session.start_time ? new Date(session.start_time) : new Date();
    const formattedDate = startTimeDate.toISOString().split('T')[0];
    const formattedTime = startTimeDate.toTimeString().split(' ')[0].substring(0, 5); // "HH:MM"

    const runPayload: Partial<Run> = {
      date: formattedDate,
      time: formattedTime,
      distance: distanceKm,
      duration: formatDuration(activeTimeS),
      averagePace: formatPace(avgSpeedMps),
      calories: session.total_calories ? Math.round(session.total_calories) : undefined,
      averageHeartRate: session.avg_heart_rate ? Math.round(session.avg_heart_rate) : undefined,
      maxHeartRate: session.max_heart_rate ? Math.round(session.max_heart_rate) : undefined,
      averageCadence: Math.round(overallCadence),
      averagePower: session.avg_power ? Math.round(session.avg_power) : undefined,
      maxPower: session.max_power ? Math.round(session.max_power) : undefined,
      averageGroundContactTime: session.avg_stance_time ? parseFloat(session.avg_stance_time.toFixed(1)) : undefined,
      // Convert mm to cm for vertical oscillation in overall run
      averageVerticalOscillation: session.avg_vertical_oscillation ? parseFloat((session.avg_vertical_oscillation / 10).toFixed(2)) : undefined,
      // Convert mm to m for stride length in overall run
      averageStrideLength: session.avg_step_length ? parseFloat((session.avg_step_length / 1000).toFixed(2)) : undefined,
      ascent: session.total_ascent ? Math.round(session.total_ascent) : 0,
      descent: session.total_descent ? Math.round(session.total_descent) : 0,
      laps: laps,
      routeCoordinates: downsampledCoords,
      timestamp: startTimeDate.getTime(),
    };

    return NextResponse.json(runPayload);
  } catch (error: any) {
    console.error('FIT parsing failed:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse FIT file.' }, { status: 500 });
  }
}
