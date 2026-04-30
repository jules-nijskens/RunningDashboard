export type RunType = 'Easy' | 'Long Run' | 'Tempo' | 'Interval' | 'Race';

export interface Lap {
  lapNumber: number;
  time: string;
  distance: number;
  avgPace: string;
  avgHR: number;
  maxHR: number;
  avgCadence: number;
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
  ascent?: number;
  descent?: number;
  timestamp: number;
  time?: string;
  weather?: string;
  location?: string;
  laps?: Lap[];
  userGoal?: string;
  surfacePercentages?: {
    bikingPath: number;
    forestTrail: number;
  };
  coachReview?: string; // Long version
  coachReviewShort?: string; // One sentence version
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
