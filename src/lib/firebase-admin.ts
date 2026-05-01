import * as admin from 'firebase-admin';

// Initialize Default App (Primary Project)
if (!admin.apps.some(app => app?.name === '[DEFAULT]')) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.SERVICE_ACCOUNT_KEY;

  if (privateKey) {
    privateKey = privateKey
      .split('\\n').join('\n')
      .replace(/\\/g, '')
      .replace(/"/g, '');
  }

  console.log("Firebase Admin: Initializing default app for project:", projectId);
  console.log("Firebase Admin: Check - ProjectID:", !!projectId, "ClientEmail:", !!clientEmail, "PrivateKey:", !!privateKey);
  
  if (projectId && clientEmail && privateKey) {
    try {
      console.log("Firebase Admin: Using Service Account for default app authentication.");
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } catch (initErr: any) {
      console.error("Firebase Admin: Initialization Error:", initErr.message);
    }
  } else {
    const missing = [];
    if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
    if (!clientEmail) missing.push("SERVICE_ACCOUNT_EMAIL");
    if (!privateKey) missing.push("SERVICE_ACCOUNT_KEY");
    console.warn("Firebase Admin: Missing variables for Service Account:", missing.join(", "));
    console.warn("Firebase Admin: Falling back to Application Default Credentials (ADC).");
    admin.initializeApp({
      projectId: projectId,
    });
  }
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
