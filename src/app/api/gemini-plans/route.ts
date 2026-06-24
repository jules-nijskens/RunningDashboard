import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const startDateStr = ninetyDaysAgo.toISOString().split('T')[0];

    const snapshot = await adminDb.collection('gemini_plans')
      .where('date', '>=', startDateStr)
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

export async function POST(request: Request) {
  try {
    await verifyAuth(request);

    const { id, date } = await request.json();
    if (!id || !date) {
      return NextResponse.json({ error: 'Missing id or date' }, { status: 400 });
    }

    await adminDb.collection('gemini_plans').doc(id).update({ date });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API Gemini Plans POST Error:", error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
