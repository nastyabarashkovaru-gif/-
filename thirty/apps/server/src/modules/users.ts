import type { User } from '@prisma/client';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';

export const profileInput = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  city: z.string().trim().max(64).nullable().optional(),
  age: z.number().int().min(14).max(99).nullable().optional(),
  occupation: z.string().trim().max(300).nullable().optional(),
  aspiration: z.string().trim().max(500).nullable().optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Неизвестный часовой пояс')
    .optional(),
  interests: z.array(z.enum(['money', 'weightloss', 'blog', 'english', 'habits', 'selfdev', 'other'])).max(7).optional(),
  visibility: z.enum(['public', 'members', 'hidden']).optional(),
  marketingOptIn: z.boolean().optional(),
});

export const CONSENT_VERSION = '2026-10-v1';

export const consentInput = z.object({
  kinds: z
    .array(z.enum(['personal_data', 'offer', 'public_reports', 'adult', 'sensitive_photos', 'marketing_messages', 'case_text', 'case_photo', 'case_name', 'autorenew']))
    .min(1),
  granted: z.boolean().default(true),
  context: z.string().max(64).optional(),
});

export async function recordConsents(userId: bigint, input: z.infer<typeof consentInput>) {
  const now = clock.now();
  await prisma.$transaction(async (tx) => {
    for (const kind of input.kinds) {
      if (!input.granted) {
        await tx.consent.updateMany({ where: { userId, kind, revokedAt: null, ...(input.context ? { context: input.context } : {}) }, data: { revokedAt: now } });
      } else {
        await tx.consent.create({ data: { userId, kind, version: CONSENT_VERSION, granted: true, context: input.context } });
      }
    }
    if (input.kinds.includes('adult') && input.granted) await tx.user.update({ where: { id: userId }, data: { isAdult: true } });
    if (input.kinds.includes('marketing_messages')) await tx.user.update({ where: { id: userId }, data: { marketingOptIn: input.granted } });
  });
}

export async function activeConsents(userId: bigint): Promise<Set<string>> {
  const rows = await prisma.consent.findMany({ where: { userId, granted: true, revokedAt: null }, select: { kind: true, context: true } });
  return new Set(rows.filter((r) => !r.context).map((r) => r.kind));
}

export function displayName(u: Pick<User, 'displayName' | 'firstName' | 'lastName'>) {
  return u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ');
}

export function publicUser(u: User) {
  return { id: u.id.toString(), name: displayName(u), username: u.username, photoUrl: u.photoUrl, city: u.city, interests: u.interests, sixMonthBadge: u.sixMonthBadge };
}
