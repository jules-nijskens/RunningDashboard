import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);
    
    const predSnap = await adminDb.doc('settings/prediction').get();
    const statsSnap = await adminDb.doc('settings/user_stats').get();
    const reportSnap = await adminDb.doc('settings/training_report').get();
    
    return NextResponse.json({
      prediction: predSnap.exists ? predSnap.data() : "MISSING",
      user_stats: statsSnap.exists ? statsSnap.data() : "MISSING",
      training_report: reportSnap.exists ? "EXISTS (Truncated)" : "MISSING"
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
