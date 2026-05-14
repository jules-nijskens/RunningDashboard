import { NextResponse } from 'next/server';
import { adminWorkoutsDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    if (!adminWorkoutsDb) {
      return NextResponse.json({ workouts: [] });
    }

    const snapshot = await adminWorkoutsDb.collection('workouts')
      .orderBy('date', 'desc')
      .get();
    
    const workouts = snapshot.docs.map(doc => {
      const data = doc.data();
      // Convert Firestore Timestamp to ISO string for the frontend
      const date = data.date?.toDate ? data.date.toDate().toISOString() : data.date;
      return {
        id: doc.id,
        ...data,
        date
      };
    });

    return NextResponse.json({ workouts });
  } catch (error: any) {
    console.error("API Workouts GET Error:", error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    await verifyAuth(request);
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing workout ID' }, { status: 400 });
    }

    if (!adminWorkoutsDb) {
      return NextResponse.json({ error: 'Workouts database not configured' }, { status: 501 });
    }

    await adminWorkoutsDb.collection('workouts').doc(id).delete();
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API Workouts DELETE Error:", error.message);
    const status = error.message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
