export interface ExtraTaskDef {
  id: string;
  label: string;
  isCustom?: boolean;
}

export interface UserProfile {
  id: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  age: number | null;
  city: string | null;
  goal: string | null;
  beforePhoto: string | null;
  beforeDescription: string | null;
  measurements: string | null;
  priceOfWord: number | null;
  forceMajeureAllowed: number;
  extraTasks: ExtraTaskDef[];
  onboardingCompleted: boolean;
  manualRank: number | null;
  goalConfirmedWinner: boolean;
  createdAt: string;
  challengeStartDate: string;
}

export interface DayReport {
  dayNumber: number;
  date: string | null;
  trainingDone: boolean;
  trainingMediaUrl: string | null;
  trainingMediaType: string | null;
  extraTasksDone: Record<string, boolean>;
}

export interface ProgressData {
  challengeDays: number;
  startDate: string;
  grid: DayReport[];
  completedTrainingDays: number;
  missedDays: number;
  forceMajeureAllowed: number;
}

export interface RatingEntry {
  userId: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  trainingDays: number;
  manualRank: number | null;
  place: number;
}

export interface FinaleStatus {
  state: 'winner' | 'not_finished' | 'finished_unconfirmed';
  message: string;
  quote?: string;
  place?: number;
  amountDue?: number | null;
  completedDays: number;
  missedDays: number;
}
