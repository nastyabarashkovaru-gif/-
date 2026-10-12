import { SPHERES, gardenLevel, localDate, isValidTimezone, isSphereId } from '@rostok/shared';
import { clock } from '../clock.js';
import { one, pool, q } from '../db.js';
import { badRequest } from '../errors.js';
import { gardenAgeDays } from './garden.js';
import { getEntitlement, subscriptionState } from './subscription.js';
import { updateTimezone } from '../auth.js';
import { track } from '../analytics.js';

export async function me(userId: number) {
  const u = (await one<any>(pool, 'SELECT * FROM users WHERE id=$1', [userId]))!;
  const settings = await one<any>(pool, 'SELECT * FROM user_settings WHERE user_id=$1', [userId]);
  const onb = await one<any>(pool, 'SELECT * FROM onboarding_progress WHERE user_id=$1', [userId]);
  const { access } = await getEntitlement(pool, userId);
  return {
    user: {
      id: u.id, firstName: u.first_name, lastName: u.last_name, username: u.username, photoUrl: u.photo_url,
      timezone: u.timezone, isDemo: u.is_demo, botStarted: u.bot_started, gardenAgeDays: gardenAgeDays(u.activated_at, u.timezone),
      activatedAt: u.activated_at,
    },
    access,
    onboarding: {
      step: onb?.step ?? 'slides', slidesSeen: onb?.slides_seen ?? 0, tutorialCompleted: !!onb?.tutorial_completed_at,
      spheresSelected: !!onb?.spheres_selected_at, completed: !!onb?.completed_at,
    },
    settings: settingsView(settings),
    subscription: await subscriptionState(userId),
  };
}

const settingsView = (s: any) => ({
  notificationsEnabled: s?.notifications_enabled ?? false,
  notifyMaxPerDay: s?.notify_max_per_day ?? 1,
  quietStart: s?.quiet_start ?? 22,
  quietEnd: s?.quiet_end ?? 9,
  habitMentions: s?.habit_mentions ?? false,
  selectedSpheres: s?.selected_spheres ?? [],
  reducedMotion: s?.reduced_motion ?? false,
});

export async function updateSettings(userId: number, p: any) {
  const cur = await one<any>(pool, 'SELECT * FROM user_settings WHERE user_id=$1', [userId]);
  const v = settingsView(cur);
  const next = { ...v };
  if (typeof p.notificationsEnabled === 'boolean') next.notificationsEnabled = p.notificationsEnabled;
  if (p.notifyMaxPerDay !== undefined) {
    if (![1, 2, 3].includes(p.notifyMaxPerDay)) throw badRequest('От 1 до 3 напоминаний в день');
    next.notifyMaxPerDay = p.notifyMaxPerDay;
  }
  for (const k of ['quietStart', 'quietEnd'] as const) {
    if (p[k] !== undefined) {
      if (!Number.isInteger(p[k]) || p[k] < 0 || p[k] > 23) throw badRequest('Часы — от 0 до 23');
      next[k] = p[k];
    }
  }
  if (typeof p.habitMentions === 'boolean') next.habitMentions = p.habitMentions;
  if (typeof p.reducedMotion === 'boolean') next.reducedMotion = p.reducedMotion;
  if (Array.isArray(p.selectedSpheres)) {
    if (!p.selectedSpheres.every(isSphereId)) throw badRequest('Неизвестная сфера');
    next.selectedSpheres = [...new Set(p.selectedSpheres as string[])];
  }
  await pool.query(
    `UPDATE user_settings SET notifications_enabled=$2, notify_max_per_day=$3, quiet_start=$4, quiet_end=$5, habit_mentions=$6,
       selected_spheres=$7, reduced_motion=$8, updated_at=now() WHERE user_id=$1`,
    [userId, next.notificationsEnabled, next.notifyMaxPerDay, next.quietStart, next.quietEnd, next.habitMentions, next.selectedSpheres, next.reducedMotion],
  );
  if (typeof p.timezone === 'string') {
    if (!isValidTimezone(p.timezone)) throw badRequest('Неизвестный часовой пояс');
    await updateTimezone(pool, userId, p.timezone);
  }
  return next;
}

/** Прогресс онбординга: сохраняется, чтобы не повторять его. Демонстрационные капли сюда не попадают. */
export async function updateOnboarding(userId: number, p: { step?: string; slidesSeen?: number; tutorialCompleted?: boolean; spheres?: string[]; paywallSeen?: boolean }) {
  const steps = ['slides', 'tutorial', 'spheres', 'paywall', 'first_task', 'done'];
  if (p.step && !steps.includes(p.step)) throw badRequest('Неизвестный шаг');
  if (p.spheres) {
    if (!p.spheres.every(isSphereId)) throw badRequest('Неизвестная сфера');
    await pool.query('UPDATE user_settings SET selected_spheres=$2 WHERE user_id=$1', [userId, [...new Set(p.spheres)]]);
    await track(pool, userId, 'spheres_selected', { count: p.spheres.length }, `spheres_selected:${userId}`);
  }
  if (p.tutorialCompleted) await track(pool, userId, 'tutorial_complete', {}, `tutorial_complete:${userId}`);
  await pool.query(
    `UPDATE onboarding_progress SET
       step=COALESCE($2, step), slides_seen=GREATEST(slides_seen, COALESCE($3, 0)),
       tutorial_completed_at=CASE WHEN $4 THEN COALESCE(tutorial_completed_at, now()) ELSE tutorial_completed_at END,
       spheres_selected_at=CASE WHEN $5 THEN COALESCE(spheres_selected_at, now()) ELSE spheres_selected_at END,
       paywall_seen_at=CASE WHEN $6 THEN COALESCE(paywall_seen_at, now()) ELSE paywall_seen_at END,
       updated_at=now() WHERE user_id=$1`,
    [userId, p.step ?? null, p.slidesSeen ?? null, !!p.tutorialCompleted, !!p.spheres, !!p.paywallSeen],
  );
  return { ok: true };
}

export async function stats(userId: number) {
  const u = (await one<any>(pool, 'SELECT * FROM users WHERE id=$1', [userId]))!;
  const trees = await q<any>(pool, 'SELECT sphere_id, level, total_spent_drops, available_drops FROM trees WHERE user_id=$1', [userId]);
  const comps = await q<{ sphere_id: string; n: number }>(pool, 'SELECT sphere_id, count(*)::int AS n FROM task_completions WHERE user_id=$1 GROUP BY sphere_id', [userId]);
  const rewards = (await one<{ total: number; claimed: number }>(
    pool,
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE r.status='claimed')::int AS claimed
     FROM reward_promises r JOIN tasks t ON t.id=r.task_id WHERE r.user_id=$1 AND t.deleted_at IS NULL`,
    [userId],
  ))!;
  const spent = trees.reduce((s, t) => s + t.total_spent_drops, 0);
  const cmap = new Map(comps.map((c) => [c.sphere_id, c.n]));
  return {
    gardenAgeDays: gardenAgeDays(u.activated_at, u.timezone),
    completionsTotal: comps.reduce((s, c) => s + c.n, 0),
    treesCount: SPHERES.length,
    rewardsClaimed: rewards.claimed,
    rewardsTotal: rewards.total,
    gardenLevel: gardenLevel(spent),
    bestOpenStreak: u.best_open_streak,
    today: localDate(clock.now(), u.timezone),
    spheres: SPHERES.map((s) => {
      const t = trees.find((x) => x.sphere_id === s.id);
      return { sphere: s.id, level: t?.level ?? 1, completions: cmap.get(s.id) ?? 0, availableDrops: t?.available_drops ?? 0 };
    }),
  };
}
