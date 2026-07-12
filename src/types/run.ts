export type RunType = 'Easy' | 'Long Run' | 'Tempo' | 'Interval' | 'Race' | 'Time Trial';

export interface Lap {
  lapNumber: number;
  time: string;
  distance: number;
  avgPace: string;
  avgHR: number;
  maxHR: number;
  avgCadence: number;
  avgPower?: number;
  avgStanceTime?: number; // Ground contact time (ms)
  avgVerticalOscillation?: number; // (mm)
  avgStepLength?: number; // Stride length (mm)
  avgTemperature?: number;
}

export interface Run {
  id?: string;
  date: string;
  runType: RunType;
  summary: string;
  distance: number;
  duration: string;
  averagePace: string;
  calories?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  averageCadence?: number;
  averagePower?: number;
  maxPower?: number;
  averageGroundContactTime?: number; // (ms)
  averageVerticalOscillation?: number; // (cm)
  averageStrideLength?: number; // (m)
  ascent?: number;
  descent?: number;
  timestamp: number;
  time?: string;
  weather?: string;
  location?: string;
  shoeId?: string;
  shoeName?: string;
  laps?: Lap[];
  userGoal?: string;
  surfacePercentages?: {
    bikingPath: number;
    forestTrail: number;
  };
  coachReview?: string; // Long version
  coachReviewShort?: string; // One sentence version
  aiDescription?: string; // AI's breakdown of the run structure
  routeCoordinates?: { lat: number; lon: number }[]; // Array of coordinate objects (nested arrays are not supported in Firestore)
}

export interface Exercise {
  weight: string;
  rating: string;
  times: string;
}

export interface Workout {
  id?: string;
  date: any; // Firestore Timestamp
  type: string;
  [key: string]: any; // For dynamic exercise keys
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface Chat {
  id?: string;
  timestamp: number;
  title: string;
  messages: ChatMessage[];
}

export interface Race {
  id?: string;
  name: string;
  date: string;
  targetDistance: number; // in km
  targetTime: string; // "HH:MM:SS" or "MM:SS"
  strategyGoal?: string; // User notes on pacing, nutrition, etc.
  coachPreview?: string; // AI generated pre-race pacing guide
  linkedRunId?: string; // ID of the actual uploaded run activity
  postRaceReview?: string; // AI post-race review comparing plan vs actuals
  status: 'planned' | 'completed';
  timestamp: number;
  strategyChatId?: string;
  reviewChatId?: string;
}

export interface Shoe {
  id?: string;
  name: string;
  maxDistance: number; // in km
  currentDistance: number; // in km
  createdAt: number;
}
