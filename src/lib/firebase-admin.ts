import * as admin from 'firebase-admin';

// Initialize Default App (Primary Project)
if (!admin.apps.some(app => app?.name === '[DEFAULT]')) {
  admin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

// Initialize Workouts App
if (!admin.apps.some(app => app?.name === 'workouts-admin')) {
  let privateKey = process.env.WORKOUTS_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey
      .split('\\n').join('\n')
      .replace(/\\/g, '')
      .replace(/"/g, '');
  }

  if (process.env.WORKOUTS_PROJECT_ID && process.env.WORKOUTS_CLIENT_EMAIL && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.WORKOUTS_PROJECT_ID,
        clientEmail: process.env.WORKOUTS_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    }, 'workouts-admin');
  }
}

const adminDb = admin.firestore();
const adminWorkoutsDb = admin.apps.find(app => app?.name === 'workouts-admin') 
  ? admin.firestore(admin.app('workouts-admin')) 
  : null;

export { adminDb, adminWorkoutsDb };
