import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function GET() {
  if (!adminDb) {
    return NextResponse.json({ error: "Workouts Admin DB not initialized. Check .env.local" }, { status: 500 });
  }

  try {
    // Admin SDK has full bypass of security rules
    const snapshot = await adminDb.collection('workouts')
      .limit(5)
      .get();
    
    const workouts: any[] = [];
    snapshot.forEach((doc) => {
      workouts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return NextResponse.json({ 
      count: workouts.length,
      sample: workouts 
    });
  } catch (error: any) {
    console.error("Admin Debug Workouts Error:", error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
