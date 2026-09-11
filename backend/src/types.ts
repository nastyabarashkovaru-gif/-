export interface ExtraTaskDef {
  id: string;
  label: string;
  isCustom?: boolean;
}

export interface UserRow {
  id: number; // telegram id
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  age: number | null;
  city: string | null;
  goal: string | null;
  before_photo: string | null;
  before_description: string | null;
  measurements: string | null;
  price_of_word: number | null;
  force_majeure_allowed: number;
  extra_tasks: string; // JSON ExtraTaskDef[]
  onboarding_completed: number;
  manual_rank: number | null;
  goal_confirmed_winner: number;
  created_at: string;
  challenge_start_date: string;
  cycle: number;
}

export interface DailyReportRow {
  id: number;
  user_id: number;
  cycle: number;
  day_number: number;
  date: string;
  training_done: number;
  training_media_url: string | null;
  training_media_type: string | null;
  extra_tasks_done: string; // JSON { [taskId]: boolean }
  created_at: string;
}

export interface PaymentRow {
  id: number;
  user_id: number;
  amount: number;
  kind: 'word_price' | 'prize_payout';
  status: 'pending' | 'paid' | 'manual_paid';
  prodamus_link: string | null;
  prodamus_order_id: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface AuthedRequest {
  telegramId: number;
}
