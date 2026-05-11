import { NextResponse } from 'next/server';
import { generatePrediction } from '@/lib/gemini';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';
import { refreshPredictionData } from '@/lib/prediction';

export async function GET(request: Request) {
  try {
    console.log("Prediction API: GET request received");
    // 0. Verify Auth
    const user = await verifyAuth(request);
    console.log("Prediction API: Auth verified for", user.email, "UID:", user.uid);

    // 1. Try to get cached prediction first from Admin DB
    try {
      const predSnap = await adminDb.doc('settings/prediction').get();
      if (predSnap.exists) {
        console.log("Prediction API: Found cached prediction");
        return NextResponse.json(predSnap.data());
      }
      console.log("Prediction API: No cached prediction found");
    } catch (dbError) {
      console.warn("Prediction: Could not fetch from Firestore, trying refresh...", dbError);
    }

    // Fallback if none exists or fetch failed
    console.log("Prediction API: Triggering automatic refresh");
    try {
      const prediction = await refreshPredictionData();
      console.log("Prediction API: Refresh successful");
      return NextResponse.json(prediction);
    } catch (refreshError: any) {
      console.error("Prediction API: Refresh FAILED", refreshError.message);
      return NextResponse.json({ 
        error: "Failed to generate a new prediction.",
        details: refreshError.message 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Prediction API Root Error:', error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status });
  }
}

export async function POST(request: Request) {
  try {
    console.log("Prediction API: POST request received (force refresh)");
    // 0. Verify Auth
    await verifyAuth(request);

    try {
      const prediction = await refreshPredictionData();
      console.log("Prediction API: Manual refresh successful");
      return NextResponse.json({ success: true, prediction });
    } catch (refreshError: any) {
      console.error("Prediction API: Manual refresh FAILED", refreshError.message);
      return NextResponse.json({ 
        success: false, 
        error: "Analysis Failed", 
        details: refreshError.message 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Prediction POST Root Error:', error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ 
      error: error.message,
      success: false 
    }, { status });
  }
}
