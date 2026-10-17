import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

export type ErrorCode =
  | 'not_found'
  | 'own_questionnaire'
  | 'already_answered'
  | 'premium_required'
  | 'threshold_not_met'
  | 'rate_limited'
  | 'invalid';

const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  own_questionnaire: 409,
  already_answered: 409,
  premium_required: 402,
  threshold_not_met: 409,
  rate_limited: 429,
  invalid: 400,
};

export class HttpError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

/** Обёртка: ошибки бизнес-логики → { code }, прочие → 500 */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const body = await fn(req, res);
      if (!res.headersSent) body === undefined ? res.status(204).end() : res.json(body);
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(STATUS[e.code]).json({ code: e.code });
        return;
      }
      console.error('[api]', req.method, req.path, e);
      res.status(500).json({ code: 'server_error' });
    }
  };

// Без похожих символов (0/O, 1/I) — id анкеты попадает в ссылку
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newId = (len: number) => Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join('');
