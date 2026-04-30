import { NextResponse } from 'next/server';
import { generatePrediction } from '@/lib/gemini';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';
import { refreshPredictionData } from '@/lib/prediction';

export async function GET(request: Request) {
  try {
    // 0. Verify Auth
    await verifyAuth(request);

    // 1. Try to get cached prediction first from Admin DB
    const predSnap = await adminDb.doc('settings/prediction').get();
    
    if (predSnap.exists) {
      return NextResponse.json(predSnap.data());
    }

    // Fallback if none exists
    const prediction = await refreshPredictionData();
    return NextResponse.json(prediction);
  } catch (error: any) {
    console.error('Prediction API Error:', error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    // 0. Verify Auth
    await verifyAuth(request);

    const prediction = await refreshPredictionData();
    return NextResponse.json({ success: true, prediction });
  } catch (error: any) {
    console.error('Prediction POST Error:', error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
