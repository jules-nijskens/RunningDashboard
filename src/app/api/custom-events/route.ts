import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/auth-server';

export async function GET(request: Request) {
  try {
    await verifyAuth(request);

    const snapshot = await adminDb.collection('custom_events')
      .orderBy('date', 'asc')
      .get();
    
    const events = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({ events });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("API Custom Events GET Error:", errMessage);
    const status = errMessage.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: errMessage }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await verifyAuth(request);
    
    const body = await request.json();
    const { id, date, startTime, title, type, description } = body;

    if (!date || !title || !type) {
      return NextResponse.json({ error: 'Missing required fields (date, title, type)' }, { status: 400 });
    }

    const eventData = {
      date, // YYYY-MM-DD
      startTime: startTime || '', // HH:MM
      title,
      type, // 'social' | 'music' | 'work' | 'other'
      description: description || '',
      updatedAt: new Date().toISOString()
    };

    if (id) {
      // Update
      await adminDb.collection('custom_events').doc(id).set(eventData, { merge: true });
      return NextResponse.json({ id, ...eventData });
    } else {
      // Add
      const docRef = await adminDb.collection('custom_events').add({
        ...eventData,
        createdAt: new Date().toISOString()
      });
      return NextResponse.json({ id: docRef.id, ...eventData });
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("API Custom Events POST Error:", errMessage);
    const status = errMessage.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: errMessage }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    await verifyAuth(request);
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing event ID' }, { status: 400 });
    }

    await adminDb.collection('custom_events').doc(id).delete();
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("API Custom Events DELETE Error:", errMessage);
    const status = errMessage.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: errMessage }, { status });
  }
}
