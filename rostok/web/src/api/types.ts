import type { SphereId, TaskKind } from '@rostok/shared';

export interface TreeState {
  sphere: SphereId; level: number; availableDrops: number; totalEarnedDrops: number; totalSpentDrops: number; totalPenaltyDrops: number;
  nextCost: number; canWater: boolean; healthVisualState: 'normal' | 'withered'; visualVariant: number;
}
export interface Garden {
  today: string;
  streak: { current: number; best: number };
  garden: { level: number; totalSpentDrops: number; levelFloor: number; nextLevelAt: number; decor: string[] };
  trees: TreeState[];
  todayProgress: { done: number; total: number };
}
export interface HistoryCell { key: string; label: string; sub?: string; status: 'done' | 'missed' | 'yes' | 'unanswered' | 'today' | 'future' | 'grace' | 'partial' | 'expired' | 'pending'; done?: number; required?: number }
export interface Reward { id: number; threshold: number; title: string; status: 'locked' | 'unlocked' | 'claimed' }
export interface Task {
  id: number; title: string; description: string | null; sphere: SphereId; kind: TaskKind; timesPerWeek: number | null; drops: number;
  hardcore: boolean; penaltyDrops: number | null; deadlineAt: string | null; habitQuestion: string | null; habitMissingPenalty: boolean;
  status: 'active' | 'completed' | 'expired' | 'deleted'; locked: boolean; completionsCount: number; createdLocalDate: string;
  today: { date: string; done: boolean; answer: 'yes' | 'no' | null; canComplete: boolean };
  week: { done: number; required: number } | null; deadlineSoon: boolean;
  pendingSchedule: { effectiveFrom: string; drops: number; timesPerWeek: number | null; hardcore: boolean } | null;
  rewards: Reward[]; history: HistoryCell[];
}
export interface Plan { id: string; title: string; subtitle: string | null; kind: 'recurring' | 'prepaid'; periodDays: number; priceStars: number; displayPriceRub: number | null; terms: string }
export interface SubscriptionState {
  access: boolean; status: string; plan: Plan | null; accessUntil: string | null; autoRenew: boolean; provider: string; isSandbox: boolean;
  nextCharge: { at: string; plan: Plan | null } | null;
}
export interface Me {
  user: { id: number; firstName: string | null; lastName: string | null; username: string | null; photoUrl: string | null; timezone: string; isDemo: boolean; botStarted: boolean; gardenAgeDays: number };
  access: boolean;
  onboarding: { step: string; slidesSeen: number; tutorialCompleted: boolean; spheresSelected: boolean; completed: boolean };
  settings: { notificationsEnabled: boolean; notifyMaxPerDay: number; quietStart: number; quietEnd: number; habitMentions: boolean; selectedSpheres: SphereId[]; reducedMotion: boolean };
  subscription: SubscriptionState;
}
export interface PublicConfig {
  brand: { appName: string; slogan: string };
  onboarding: { slides: { id: string; title: string; text: string; art: string }[]; tutorialIntro: string };
  paywall: { title: string; subtitle: string; bullets: string[] };
  flags: Record<string, boolean>;
  assets: any;
  demoLogin: boolean;
  env: string;
  botUsername: string | null;
  supportUsername: string | null;
}
export interface Challenge {
  id: number; title: string; goal: number; endsOn: string | null; isOwner: boolean; canInvite: boolean;
  participants: { isMe: boolean; name: string; progress: number }[];
}
export interface Stats {
  gardenAgeDays: number; completionsTotal: number; treesCount: number; rewardsClaimed: number; rewardsTotal: number; gardenLevel: number; bestOpenStreak: number;
  spheres: { sphere: SphereId; level: number; completions: number; availableDrops: number }[];
}
