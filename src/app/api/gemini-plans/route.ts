import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    const todayStr = new Date().toISOString().split('T')[0];
    const snapshot = await adminDb.collection('gemini_plans')
      .where('date', '>=', todayStr)
      .orderBy('date', 'asc')
      .get();
    
    const plans = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({ plans });
  } catch (error: any) {
    console.error("API Gemini Plans GET Error:", error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
