import { createContext, useContext } from 'react';

export interface Me {
  user: { id: string; name: string; firstName: string; displayName: string | null; city: string | null; interests: string[]; timezone: string; visibility: string; isAdult: boolean; marketingOptIn: boolean; allowsWrite: boolean; onboardingStage: string; lastScreen: string | null; photoUrl: string | null; sixMonthBadge: boolean };
  consents: string[];
  startParam: string | null;
  membership: { id: string; status: string; tariffId: string; registeredAt: string | null; flow: { id: string; title: string; startsOn: string; endsOn: string; days: number; phase: string; today: string } } | null;
  subscription: { id: string; status: string; tariffId: string; tariffTitle: string; autoRenew: boolean } | null;
}

export const MeContext = createContext<{ me: Me | null; refresh: () => Promise<Me | null> }>({ me: null, refresh: async () => null });
export const useMe = () => useContext(MeContext);
