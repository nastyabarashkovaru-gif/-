import { randomUUID } from 'node:crypto';
import { EVENT_NAMES } from '@thirty/domain';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';

const KNOWN = new Set<string>(EVENT_NAMES);

export const clientEvent = z.object({
  event_id: z.string().min(8).max(64),
  session_id: z.string().min(4).max(64),
  event_name: z.string().max(64),
  screen_id: z.string().max(32).optional(),
  flow_id: z.string().max(64).optional(),
  tariff_id: z.string().max(16).optional(),
  experiment_variant: z.string().max(64).optional(),
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const clientBatch = z.object({ events: z.array(clientEvent).max(100), device: z.string().max(64).optional() });

/**
 * Приём событий от клиента: user_id берём только из проверенного initData, дубликаты по event_id отбрасываются.
 * Неизвестные имена событий не принимаются. Время клиента ограничено окном ±1 сутки.
 */
export async function ingest(userId: bigint | null, batch: z.infer<typeof clientBatch>) {
  const now = clock.now();
  const rows = batch.events
    .filter((e) => KNOWN.has(e.event_name))
    .map((e) => {
      let ts = e.timestamp ? new Date(e.timestamp) : now;
      if (Math.abs(ts.getTime() - now.getTime()) > 24 * 3600_000) ts = now;
      const metadata = JSON.stringify(e.metadata ?? {}).length > 4000 ? {} : (e.metadata ?? {});
      return {
        eventId: e.event_id,
        userId,
        sessionId: e.session_id,
        eventName: e.event_name,
        screenId: e.screen_id,
        flowId: e.flow_id,
        tariffId: e.tariff_id,
        variant: e.experiment_variant,
        device: batch.device,
        ts,
        metadata: metadata as object,
      };
    });
  if (!rows.length) return { accepted: 0 };
  const r = await prisma.analyticsEvent.createMany({ data: rows, skipDuplicates: true });
  return { accepted: r.count };
}

/** Серверное событие (оплата, отчёт, бот). Ошибка аналитики не ломает основной сценарий. */
export async function track(e: {
  userId: bigint | null;
  eventName: (typeof EVENT_NAMES)[number];
  screenId?: string;
  flowId?: string;
  tariffId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventId: e.dedupeKey ? `srv:${e.dedupeKey}` : `srv:${randomUUID()}`,
        userId: e.userId,
        sessionId: 'server',
        eventName: e.eventName,
        screenId: e.screenId,
        flowId: e.flowId,
        tariffId: e.tariffId,
        ts: clock.now(),
        metadata: (e.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002')) console.warn('[analytics]', (err as Error).message);
  }
}
