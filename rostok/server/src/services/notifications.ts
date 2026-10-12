import { DateTime } from 'luxon';
import { localDate, sphereById, wateringCost, dropsLabel, completionsLabel, weekStart } from '@rostok/shared';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { one, pool, q } from '../db.js';
import { getCurve, getValue } from '../appConfig.js';
import { DEFAULT_NOTIFICATION_TEXTS } from '../content.js';
import { tg } from '../telegramApi.js';
import { hasAccess } from './subscription.js';

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

function inQuietHours(hour: number, start: number, end: number) {
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function openAppButton(text: string, screen?: string) {
  const startParam = screen ? `go_${screen}` : '';
  if (config.botUsername && config.appShortName) {
    return { text, url: `https://t.me/${config.botUsername}/${config.appShortName}${startParam ? `?startapp=${startParam}` : ''}` };
  }
  return { text, web_app: { url: `${config.publicUrl}/${startParam ? `?startapp=${startParam}` : ''}` } };
}

interface Candidate { kind: string; key: string; text: string; button: string; screen?: string }

/** Кандидаты напоминаний для пользователя. Тексты не раскрывают содержимое вредных привычек без явного согласия. */
async function candidates(u: any, today: string): Promise<Candidate[]> {
  const texts = { ...DEFAULT_NOTIFICATION_TEXTS, ...((await getValue<any>('notification_texts')) ?? {}) };
  const curve = await getCurve();
  const out: Candidate[] = [];
  const deadlines = await q<any>(
    pool,
    `SELECT id, title, kind, deadline_at FROM tasks WHERE user_id=$1 AND kind='once' AND status='active' AND deleted_at IS NULL AND deadline_at > $2`,
    [u.id, clock.now()],
  );
  for (const t of deadlines) {
    if (localDate(t.deadline_at, u.timezone) === today) out.push({ kind: 'deadline', key: `deadline:${t.id}`, text: fill(texts.deadline, { task: t.title }), button: 'Открыть задачу', screen: 'tasks' });
  }
  const trees = await q<any>(pool, 'SELECT sphere_id, level, available_drops, last_activity_at FROM trees WHERE user_id=$1', [u.id]);
  for (const t of trees) {
    const need = wateringCost(t.level, curve) - t.available_drops;
    if (need > 0 && need <= 2) {
      out.push({ kind: 'almost_water', key: `almost:${t.sphere_id}:${t.level}`, text: fill(texts.almostWater, { sphere: sphereById(t.sphere_id)!.name, n: need, drops: dropsLabel(need).split(' ')[1] }), button: 'Открыть сад' });
    }
  }
  const gifts = await q<any>(
    pool,
    `SELECT r.id, r.title, r.threshold, t.completions_count, t.kind FROM reward_promises r JOIN tasks t ON t.id=r.task_id
     WHERE r.user_id=$1 AND r.status='locked' AND t.deleted_at IS NULL AND t.status='active' AND r.threshold - t.completions_count BETWEEN 1 AND 3`,
    [u.id],
  );
  for (const g of gifts) {
    if (g.kind === 'habit' && !u.habit_mentions) continue;
    const n = g.threshold - g.completions_count;
    out.push({ kind: 'gift_close', key: `gift:${g.id}:${g.completions_count}`, text: fill(texts.giftClose, { gift: g.title, n, completions: completionsLabel(n).split(' ').slice(1).join(' ') }), button: 'Открыть задачу', screen: 'tasks' });
  }
  const lastActivity = trees.reduce((m: number, t: any) => Math.max(m, t.last_activity_at ? new Date(t.last_activity_at).getTime() : 0), 0);
  if (lastActivity && clock.now().getTime() - lastActivity > 3 * 86400_000) {
    out.push({ kind: 'bored', key: `bored:${weekStart(today)}`, text: texts.bored, button: 'Открыть сад' });
  }
  return out;
}

/** Рассылка opt-in напоминаний: лимит в день, тихие часы, дедупликация по dedupe_key. */
export async function sendReminders() {
  const flags = (await getValue<any>('flags')) ?? {};
  if (!flags.reminders || !config.botToken) return 0;
  const users = await q<any>(
    pool,
    `SELECT u.id, u.telegram_id, u.timezone, s.notify_max_per_day, s.quiet_start, s.quiet_end, s.habit_mentions,
       sub.status, sub.current_period_end, sub.auto_renew
     FROM users u JOIN user_settings s ON s.user_id=u.id LEFT JOIN subscriptions sub ON sub.user_id=u.id
     WHERE s.notifications_enabled AND u.bot_started AND NOT u.bot_blocked AND NOT u.is_demo AND u.deleted_at IS NULL`,
  );
  let sent = 0;
  for (const u of users) {
    if (!hasAccess(u)) continue;
    const local = DateTime.fromJSDate(clock.now(), { zone: u.timezone });
    if (inQuietHours(local.hour, u.quiet_start, u.quiet_end) || local.hour < 9 || local.hour >= 21) continue;
    const today = local.toISODate()!;
    const [{ n }] = await q<{ n: number }>(pool, `SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND local_date=$2 AND status='sent'`, [u.id, today]);
    if (n >= u.notify_max_per_day) continue;
    // не чаще раза в 3 часа
    const recent = await one(pool, `SELECT 1 FROM notifications WHERE user_id=$1 AND status='sent' AND sent_at > now() - interval '3 hours'`, [u.id]);
    if (recent) continue;
    for (const c of await candidates(u, today)) {
      const ins = await one<{ id: number }>(
        pool,
        `INSERT INTO notifications(user_id, kind, dedupe_key, local_date, text) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [u.id, c.kind, `${u.id}:${c.key}`, today, c.text],
      );
      if (!ins) continue;
      try {
        await tg('sendMessage', { chat_id: u.telegram_id, text: c.text, reply_markup: { inline_keyboard: [[openAppButton(c.button, c.screen)]] } });
        await pool.query(`UPDATE notifications SET status='sent', sent_at=now() WHERE id=$1`, [ins.id]);
        sent++;
      } catch (e: any) {
        await pool.query(`UPDATE notifications SET status='failed', error=$2 WHERE id=$1`, [ins.id, String(e.message).slice(0, 300)]);
        if (e.code === 403) await pool.query('UPDATE users SET bot_blocked=true WHERE id=$1', [u.id]);
      }
      break; // одно сообщение за проход
    }
  }
  return sent;
}
